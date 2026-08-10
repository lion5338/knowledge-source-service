import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { HttpError } from "../http/errors.js";
import { getCollection as defaultGetCollection } from "../source-collections/source-collections.js";
import { getNormalizedArtifactAdapter } from "./adapters/registry.js";
import { validateNormalizedArtifact } from "./normalized-artifact-validation.js";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceArtifactError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizedSubjectForK12(filePath) {
  return filePath.includes("math") ? "mathematics" : "unknown";
}

function normalizedStageForK12(filePath) {
  if (filePath.includes("_7") || filePath.includes("_8") || filePath.includes("_9")) {
    return "junior_high";
  }
  return "primary";
}

function nodeTypeFor(rawNode) {
  return rawNode.label ?? rawNode.node_type ?? "Concept";
}

function normalizeK12Node({ rawNode, collection, filePath }) {
  const subject = normalizedSubjectForK12(filePath);
  const learningStage = normalizedStageForK12(filePath);
  const source = collection.source_ids?.[0] ?? "k12_dataset";
  return {
    id: rawNode.id,
    label: rawNode.name ?? rawNode.label ?? rawNode.id,
    aliases: [rawNode.name, rawNode.label].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index),
    subject,
    learning_stage: learningStage,
    node_type: nodeTypeFor(rawNode),
    description: rawNode.properties?.definition ?? rawNode.properties?.description ?? null,
    source_ref: {
      collection_id: collection.collection_id,
      source,
      source_topic_id: rawNode.id,
    },
    license_scope: collection.license_scope,
    metadata: {
      raw_file: filePath,
      raw_properties: rawNode.properties ?? {},
    },
  };
}

function normalizeK12Edge({ rawEdge, collection }) {
  return {
    source_node_id: rawEdge.source,
    target_node_id: rawEdge.target,
    edge_type: rawEdge.type ?? "related_to",
    source_ref: {
      collection_id: collection.collection_id,
      source: collection.source_ids?.[0] ?? "k12_dataset",
      source_edge_id: `${rawEdge.source}:${rawEdge.type ?? "related_to"}:${rawEdge.target}`,
    },
    license_scope: collection.license_scope,
    metadata: {
      source_name: rawEdge.source_name ?? null,
      target_name: rawEdge.target_name ?? null,
      raw_properties: rawEdge.properties ?? {},
    },
  };
}

function artifactEnvelope({ collection, snapshot, artifactType, nodes, edges }) {
  const sortedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...edges].sort((left, right) =>
    `${left.source_node_id}:${left.edge_type}:${left.target_node_id}`.localeCompare(
      `${right.source_node_id}:${right.edge_type}:${right.target_node_id}`,
    ),
  );
  const core = {
    collection_id: collection.collection_id,
    artifact_type: artifactType,
    schema_version: "source_graph.v1",
    source_snapshot_id: snapshot.snapshot_id,
    license_scope: collection.license_scope,
    attribution: collection.attribution ?? null,
    nodes: sortedNodes,
    edges: sortedEdges,
    summary: {
      node_count: sortedNodes.length,
      edge_count: sortedEdges.length,
      subjects: [...new Set(sortedNodes.map((node) => node.subject).filter(Boolean))].sort(),
    },
  };
  const checksum = sha256Text(stableStringify(core));
  return {
    artifact_id: `source-artifact:${collection.collection_id}:${artifactType}:sha256:${checksum}`,
    checksum_sha256: checksum,
    ...core,
  };
}

export async function buildNormalizedArtifact({
  collection,
  snapshot,
  sourceRoot,
  artifactType = "normalized_knowledge_graph",
} = {}) {
  if (collection.collection_id !== "k12_kgraph_full" || artifactType !== "normalized_knowledge_graph") {
    return getNormalizedArtifactAdapter({ collectionId: collection.collection_id, artifactType }).buildArtifact({
      collection,
      snapshot,
      sourceRoot,
    });
  }
  if (collection.collection_id !== "k12_kgraph_full" || artifactType !== "normalized_knowledge_graph") {
    throw sourceArtifactError(
      `Normalized artifact build is not supported for collection/type: ${collection.collection_id}/${artifactType}`,
      "source_collection_not_supported",
      { collection_id: collection.collection_id, artifact_type: artifactType },
    );
  }
  const graphFiles = (snapshot.raw_manifest?.detected_files ?? [])
    .map((file) => file.path)
    .filter((filePath) => filePath.startsWith("kg/") && filePath.endsWith(".json"))
    .sort();
  if (graphFiles.length === 0) {
    throw sourceArtifactError("K12 snapshot does not include kg/*.json files.", "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
    });
  }

  const nodes = [];
  const edges = [];
  for (const filePath of graphFiles) {
    const graph = await readJson(path.join(sourceRoot, filePath));
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw sourceArtifactError(`K12 graph file has invalid shape: ${filePath}`, "normalized_artifact_invalid_source_shape", {
        collection_id: collection.collection_id,
        file_path: filePath,
      });
    }
    nodes.push(...graph.nodes.map((rawNode) => normalizeK12Node({ rawNode, collection, filePath })));
    edges.push(...graph.edges.map((rawEdge) => normalizeK12Edge({ rawEdge, collection })));
  }

  return artifactEnvelope({ collection, snapshot, artifactType, nodes, edges });
}

function sourceDirectoryCandidates(sourceIds = []) {
  return [...new Set(sourceIds.flatMap((sourceId) => [sourceId, sourceId.replaceAll("_", "-")]))];
}

async function resolveDefaultSourceRoot({ collection }) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const rawRoot = path.join(storageRoot, "raw");
  for (const sourceDirectory of sourceDirectoryCandidates(collection.source_ids)) {
    const sourceRoot = path.join(rawRoot, sourceDirectory);
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
    const versions = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(sourceRoot, entry.name);
        const stat = await fs.stat(fullPath);
        versions.push({ fullPath, mtimeMs: stat.mtimeMs, name: entry.name });
      }
    }
    versions.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
    if (versions[0]) {
      return versions[0].fullPath;
    }
  }
  throw sourceArtifactError(`No managed raw snapshot directory was found for ${collection.collection_id}.`, "source_snapshot_missing_required_file", {
    collection_id: collection.collection_id,
  });
}

async function writeDefaultArtifact(artifact) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const storagePath = `source-artifacts/${artifact.collection_id}/${artifact.artifact_type}/sha256/${artifact.checksum_sha256}.json`;
  const fullPath = path.join(storageRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return {
    storage_path: storagePath,
    checksum_sha256: artifact.checksum_sha256,
  };
}

async function upsertArtifact(client, { collection, artifact, artifactWrite, publishStatus }) {
  await client.query(
    `
      INSERT INTO knowledge_source_artifacts
        (artifact_id, artifact_type, source, source_version, storage_path, content_type, publish_status, record_count, checksum_sha256, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (artifact_id) DO UPDATE SET
        artifact_type = EXCLUDED.artifact_type,
        source = EXCLUDED.source,
        source_version = EXCLUDED.source_version,
        storage_path = EXCLUDED.storage_path,
        content_type = EXCLUDED.content_type,
        publish_status = EXCLUDED.publish_status,
        record_count = EXCLUDED.record_count,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      artifact.artifact_id,
      artifact.artifact_type,
      collection.source_ids?.[0] ?? null,
      artifact.source_snapshot_id,
      artifactWrite.storage_path,
      "application/json",
      publishStatus,
      artifact.summary.node_count ?? artifact.summary.record_count ?? null,
      artifactWrite.checksum_sha256,
      JSON.stringify({
        collection_id: artifact.collection_id,
        schema_version: artifact.schema_version,
        source_snapshot_id: artifact.source_snapshot_id,
        license_scope: artifact.license_scope,
        publish_profiles: collection.publish_profiles ?? [],
      }),
    ],
  );
}

async function insertBuildAuditEvent(client, { actor, artifact, artifactWrite }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "source_artifact.built",
      actor,
      "source_artifact",
      artifact.artifact_id,
      JSON.stringify({
        collection_id: artifact.collection_id,
        artifact_id: artifact.artifact_id,
        artifact_type: artifact.artifact_type,
        checksum_sha256: artifact.checksum_sha256,
        storage_path: artifactWrite.storage_path,
      }),
    ],
  );
}

export function createNormalizedArtifactBuilder({
  withClient = defaultWithClient,
  getCollection = defaultGetCollection,
  resolveSourceRoot = resolveDefaultSourceRoot,
  writeArtifact = writeDefaultArtifact,
  buildArtifact = buildNormalizedArtifact,
} = {}) {
  async function buildSourceArtifact({ collectionId, artifactType, actor = "script", publishStatus = "validated" } = {}) {
    const collection = await getCollection(collectionId);
    const sourceRoot = await resolveSourceRoot({ collectionId, collection });
    const snapshot = collection.snapshot;
    if (!snapshot?.snapshot_id) {
      throw sourceArtifactError(`Source collection has no current snapshot: ${collectionId}`, "source_snapshot_not_found", {
        collection_id: collectionId,
      });
    }
    const artifact = await buildArtifact({ collection, snapshot, sourceRoot, artifactType });
    const validation = validateNormalizedArtifact(artifact);
    if (!validation.ok) {
      throw sourceArtifactError("Normalized artifact failed validation.", "normalized_artifact_invalid", {
        errors: validation.errors,
      });
    }
    const artifactWrite = await writeArtifact(artifact);

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertArtifact(client, { collection, artifact, artifactWrite, publishStatus });
        await insertBuildAuditEvent(client, { actor, artifact, artifactWrite });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    return {
      object: "source_artifact_build_result",
      collection_id: collectionId,
      artifact: {
        artifact_id: artifact.artifact_id,
        artifact_type: artifact.artifact_type,
        storage_path: artifactWrite.storage_path,
        checksum_sha256: artifactWrite.checksum_sha256,
        publish_status: publishStatus,
        summary: artifact.summary,
        validation,
      },
    };
  }

  return {
    buildSourceArtifact,
  };
}
