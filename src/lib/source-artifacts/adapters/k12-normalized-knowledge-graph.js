import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { HttpError } from "../../http/errors.js";

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

function adapterError(message, code, details = null) {
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

function toStoragePath(value) {
  return value.replace(/\\/g, "/");
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function listJsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listJsonFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function inspectDetectedFile(sourceRoot, relativePath) {
  const fullPath = path.join(sourceRoot, relativePath);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }
  return {
    path: toStoragePath(relativePath),
    bytes: stat.size,
    checksum_sha256: await sha256File(fullPath),
  };
}

async function inspectRawManifest({ sourceRoot }) {
  const missingFiles = [];
  const manifest = await inspectDetectedFile(sourceRoot, "manifest.json");
  const snapshot = await inspectDetectedFile(sourceRoot, "snapshot.json");
  if (!manifest) missingFiles.push("manifest.json");
  if (!snapshot) missingFiles.push("snapshot.json");

  const kgRoot = path.join(sourceRoot, "kg");
  const kgFiles = (await listJsonFiles(kgRoot)).sort((left, right) => left.localeCompare(right));
  if (kgFiles.length === 0) {
    missingFiles.push("kg/*.json");
  }
  if (missingFiles.length) {
    throw adapterError(`K12 source snapshot is missing required raw files: ${missingFiles.join(", ")}`, "source_snapshot_missing_required_file", {
      collection_id: "k12_kgraph_full",
      missing_files: missingFiles,
    });
  }

  const detectedFiles = [manifest, snapshot];
  for (const filePath of kgFiles) {
    const stat = await fs.stat(filePath);
    detectedFiles.push({
      path: toStoragePath(path.relative(sourceRoot, filePath)),
      bytes: stat.size,
      checksum_sha256: await sha256File(filePath),
    });
  }
  detectedFiles.sort((left, right) => left.path.localeCompare(right.path));

  return {
    file_count: detectedFiles.length,
    total_bytes: detectedFiles.reduce((total, file) => total + file.bytes, 0),
    detected_files: detectedFiles,
  };
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
  const source = collection.source_ids?.[0] ?? "k12_dataset";
  return {
    id: rawNode.id,
    label: rawNode.name ?? rawNode.label ?? rawNode.id,
    aliases: [rawNode.name, rawNode.label].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index),
    subject: normalizedSubjectForK12(filePath),
    learning_stage: normalizedStageForK12(filePath),
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

function graphEnvelope({ collection, snapshot, nodes, edges }) {
  const sortedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...edges].sort((left, right) =>
    `${left.source_node_id}:${left.edge_type}:${left.target_node_id}`.localeCompare(
      `${right.source_node_id}:${right.edge_type}:${right.target_node_id}`,
    ),
  );
  const core = {
    collection_id: collection.collection_id,
    artifact_type: "normalized_knowledge_graph",
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
    artifact_id: `source-artifact:${collection.collection_id}:normalized_knowledge_graph:sha256:${checksum}`,
    checksum_sha256: checksum,
    ...core,
  };
}

async function buildArtifact({ collection, snapshot, sourceRoot }) {
  const graphFiles = (snapshot.raw_manifest?.detected_files ?? [])
    .map((file) => file.path)
    .filter((filePath) => filePath.startsWith("kg/") && filePath.endsWith(".json"))
    .sort();
  if (graphFiles.length === 0) {
    throw adapterError("K12 snapshot does not include kg/*.json files.", "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
    });
  }

  const nodes = [];
  const edges = [];
  for (const filePath of graphFiles) {
    const graph = await readJson(path.join(sourceRoot, filePath));
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw adapterError(`K12 graph file has invalid shape: ${filePath}`, "normalized_artifact_invalid_source_shape", {
        collection_id: collection.collection_id,
        file_path: filePath,
      });
    }
    nodes.push(...graph.nodes.map((rawNode) => normalizeK12Node({ rawNode, collection, filePath })));
    edges.push(...graph.edges.map((rawEdge) => normalizeK12Edge({ rawEdge, collection })));
  }

  return graphEnvelope({ collection, snapshot, nodes, edges });
}

export const k12NormalizedKnowledgeGraphAdapter = {
  collection_id: "k12_kgraph_full",
  artifact_type: "normalized_knowledge_graph",
  inspectRawManifest,
  buildArtifact,
};
