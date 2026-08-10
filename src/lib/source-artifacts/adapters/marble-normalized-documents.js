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

function normalizeSubject(value) {
  return String(value ?? "unspecified").trim().toLowerCase().replace(/\s+/g, "_") || "unspecified";
}

function marbleLearningStage(topic) {
  const start = Number(topic.ageRangeStart);
  const end = Number(topic.ageRangeEnd);
  const age = Number.isFinite(start) ? start : end;
  if (!Number.isFinite(age)) return "unspecified";
  if (age <= 10) return "elementary";
  if (age <= 13) return "middle_school";
  return "high_school";
}

function marbleText(topic) {
  return [
    topic.description,
    ...(Array.isArray(topic.evidence) ? topic.evidence : []),
    topic.assessmentPrompt,
    topic.domain,
    topic.type,
  ]
    .filter(Boolean)
    .join("\n");
}

function recordFromTopic({ topic, collection }) {
  return {
    id: topic.id,
    title: topic.name ?? topic.id,
    subject: normalizeSubject(topic.subject),
    learning_stage: marbleLearningStage(topic),
    text: marbleText(topic),
    source_ref: {
      collection_id: collection.collection_id,
      source: collection.source_ids?.[0] ?? "marble",
      topic_id: topic.id,
    },
    license_scope: collection.license_scope,
    metadata: {
      domain: topic.domain ?? null,
      type: topic.type ?? null,
      age_range_start: topic.ageRangeStart ?? null,
      age_range_end: topic.ageRangeEnd ?? null,
      evidence_count: Array.isArray(topic.evidence) ? topic.evidence.length : 0,
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
  const requiredFiles = ["topics.json", "snapshot.json"];
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
  const dependenciesPath = path.join(sourceRoot, "dependencies.json");
  const dependenciesStat = await fs.stat(dependenciesPath).catch(() => null);
  if (dependenciesStat?.isFile()) {
    detectedFiles.push({
      path: "dependencies.json",
      bytes: dependenciesStat.size,
      checksum_sha256: sha256Text(await fs.readFile(dependenciesPath, "utf8")),
    });
  }
  if (missingFiles.length) {
    throw adapterError(`Marble source snapshot is missing required raw files: ${missingFiles.join(", ")}`, "source_snapshot_missing_required_file", {
      collection_id: "marble",
      missing_files: missingFiles,
    });
  }
  detectedFiles.sort((left, right) => left.path.localeCompare(right.path));
  return {
    file_count: detectedFiles.length,
    total_bytes: detectedFiles.reduce((sum, file) => sum + file.bytes, 0),
    detected_files: detectedFiles,
  };
}

async function buildArtifact({ collection, snapshot, sourceRoot }) {
  const topicsPath = path.join(sourceRoot, "topics.json");
  const payload = await readJson(topicsPath).catch((error) => {
    throw adapterError(`Marble topics.json could not be read: ${error.message}`, "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
      file_path: "topics.json",
    });
  });
  if (!Array.isArray(payload.topics)) {
    throw adapterError("Marble topics.json must contain a topics array.", "normalized_artifact_invalid_source_shape", {
      collection_id: collection.collection_id,
      file_path: "topics.json",
    });
  }
  const records = payload.topics
    .filter((topic) => topic?.id)
    .map((topic) => recordFromTopic({ topic, collection }));
  return documentsEnvelope({ collection, snapshot, records });
}

export const marbleNormalizedDocumentsAdapter = {
  collection_id: "marble",
  artifact_type: "normalized_documents",
  inspectRawManifest,
  buildArtifact,
};
