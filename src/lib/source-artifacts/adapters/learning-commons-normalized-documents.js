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

async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeSubject(value) {
  return String(value ?? "unspecified").trim().toLowerCase().replace(/\s+/g, "_") || "unspecified";
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function gradeLearningStage(value) {
  const grades = parseJsonArray(value)
    .map((grade) => Number(String(grade).replace(/[^0-9]/g, "")))
    .filter(Number.isFinite);
  const grade = Math.min(...grades);
  if (!Number.isFinite(grade)) return "unspecified";
  if (grade <= 5) return "elementary";
  if (grade <= 8) return "middle_school";
  return "high_school";
}

function recordText(properties) {
  return [
    properties.name,
    properties.curriculumLabel,
    properties.educationalUse,
    properties.audience,
    properties.courseCode,
    properties.author,
    properties.provider,
  ]
    .filter(Boolean)
    .join("\n");
}

function recordFromNode({ node, collection }) {
  const properties = node.properties ?? {};
  const id = properties.identifier ?? node.identifier;
  const title = properties.name ?? properties.curriculumLabel;
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    subject: normalizeSubject(properties.academicSubject),
    learning_stage: gradeLearningStage(properties.gradeLevel),
    text: recordText(properties),
    source_ref: {
      collection_id: collection.collection_id,
      source: collection.source_ids?.[0] ?? "learning_commons",
      topic_id: id,
    },
    license_scope: collection.license_scope,
    metadata: {
      labels: node.labels ?? [],
      educational_use: properties.educationalUse ?? null,
      course_code: properties.courseCode ?? null,
      curriculum_label: properties.curriculumLabel ?? null,
      provider: properties.provider ?? null,
      license: properties.license ?? null,
    },
  };
}

function documentsEnvelope({ collection, snapshot, records }) {
  const sortedRecords = [...records].sort((left, right) => left.id.localeCompare(right.id));
  const core = {
    collection_id: collection.collection_id,
    artifact_type: "normalized_documents",
    schema_version: "source_documents.v1",
    source_snapshot_id: snapshot.snapshot_id,
    license_scope: collection.license_scope,
    attribution: collection.attribution ?? null,
    records: sortedRecords,
    summary: {
      record_count: sortedRecords.length,
      subjects: [...new Set(sortedRecords.map((record) => record.subject).filter(Boolean))].sort(),
    },
  };
  const checksum = sha256Text(stableStringify(core));
  return {
    artifact_id: `source-artifact:${collection.collection_id}:normalized_documents:sha256:${checksum}`,
    checksum_sha256: checksum,
    ...core,
  };
}

async function inspectRawManifest({ sourceRoot }) {
  const requiredFiles = ["nodes.jsonl", "relationships.jsonl", "snapshot.json"];
  const detectedFiles = [];
  const missingFiles = [];
  for (const relativePath of requiredFiles) {
    const fullPath = path.join(sourceRoot, relativePath);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) {
      missingFiles.push(relativePath);
      continue;
    }
    detectedFiles.push({
      path: relativePath,
      bytes: stat.size,
      checksum_sha256: sha256Text(await fs.readFile(fullPath, "utf8")),
    });
  }
  if (missingFiles.length) {
    throw adapterError(
      `Learning Commons source snapshot is missing required raw files: ${missingFiles.join(", ")}`,
      "source_snapshot_missing_required_file",
      {
        collection_id: "learning_commons",
        missing_files: missingFiles,
      },
    );
  }
  detectedFiles.sort((left, right) => left.path.localeCompare(right.path));
  return {
    file_count: detectedFiles.length,
    total_bytes: detectedFiles.reduce((sum, file) => sum + file.bytes, 0),
    detected_files: detectedFiles,
  };
}

async function buildArtifact({ collection, snapshot, sourceRoot }) {
  const nodesPath = path.join(sourceRoot, "nodes.jsonl");
  const nodes = await readJsonLines(nodesPath).catch((error) => {
    throw adapterError(`Learning Commons nodes.jsonl could not be read: ${error.message}`, "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
      file_path: "nodes.jsonl",
    });
  });
  const records = nodes
    .filter((node) => node?.type === "node")
    .map((node) => recordFromNode({ node, collection }))
    .filter(Boolean);
  if (!records.length) {
    throw adapterError("Learning Commons nodes.jsonl did not contain any normalizable document nodes.", "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
      file_path: "nodes.jsonl",
    });
  }
  return documentsEnvelope({ collection, snapshot, records });
}

export const learningCommonsNormalizedDocumentsAdapter = {
  collection_id: "learning_commons",
  artifact_type: "normalized_documents",
  inspectRawManifest,
  buildArtifact,
};
