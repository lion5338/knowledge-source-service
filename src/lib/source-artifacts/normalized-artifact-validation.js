const supportedSchemas = new Set(["source_graph.v1", "source_documents.v1"]);

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
  return output;
}

function looksLikePrivateRawPath(text) {
  return (
    /^[A-Za-z]:[\\/]/.test(text) ||
    /^\\\\[^\\]+\\[^\\]+/.test(text) ||
    /(^|[\\/])raw[\\/]/.test(text) ||
    text.includes("storage/knowledge/raw") ||
    text.includes("storage\\knowledge\\raw")
  );
}

function hasRawPathLeak(value) {
  return collectStrings(value).some((text) => looksLikePrivateRawPath(text));
}

function error(code, message, details = null) {
  return { code, message, details };
}

function validateCommonEnvelope(artifact, errors) {
  if (!artifact?.artifact_id) {
    errors.push(error("normalized_artifact_missing_artifact_id", "Normalized artifact is missing artifact_id."));
  }
  if (!artifact?.collection_id) {
    errors.push(error("normalized_artifact_missing_collection_id", "Normalized artifact is missing collection_id."));
  }
  if (!artifact?.source_snapshot_id) {
    errors.push(error("normalized_artifact_missing_source_snapshot_id", "Normalized artifact is missing source_snapshot_id."));
  }
  if (!artifact?.license_scope) {
    errors.push(error("normalized_artifact_missing_license_scope", "Normalized artifact is missing license_scope."));
  }
  if (!supportedSchemas.has(artifact?.schema_version)) {
    errors.push(error("normalized_artifact_unsupported_schema", "Normalized artifact schema_version is not supported."));
  }
  if (hasRawPathLeak(artifact)) {
    errors.push(error("normalized_artifact_raw_path_leak", "Normalized artifact contains a private raw path."));
  }
}

function validateRecord(record, index, errors) {
  if (!record.source_ref) {
    errors.push(error("normalized_artifact_missing_source_ref", "Normalized artifact record is missing source_ref.", { index }));
  }
  if (!record.license_scope) {
    errors.push(error("normalized_artifact_missing_license_scope", "Normalized artifact record is missing license_scope.", { index }));
  }
}

function validateGraph(artifact, errors) {
  if (!Array.isArray(artifact.nodes) || !Array.isArray(artifact.edges)) {
    errors.push(error("normalized_artifact_invalid_shape", "source_graph.v1 requires nodes and edges arrays."));
    return 0;
  }
  artifact.nodes.forEach((node, index) => validateRecord(node, index, errors));
  return artifact.nodes.length;
}

function validateDocuments(artifact, errors) {
  if (!Array.isArray(artifact.records)) {
    errors.push(error("normalized_artifact_invalid_shape", "source_documents.v1 requires records array."));
    return 0;
  }
  artifact.records.forEach((record, index) => validateRecord(record, index, errors));
  return artifact.records.length;
}

export function validateNormalizedArtifact(artifact) {
  const errors = [];
  validateCommonEnvelope(artifact, errors);
  const recordCount =
    artifact?.schema_version === "source_graph.v1"
      ? validateGraph(artifact, errors)
      : artifact?.schema_version === "source_documents.v1"
        ? validateDocuments(artifact, errors)
        : 0;

  return {
    ok: errors.length === 0,
    error_count: errors.length,
    errors,
    summary: {
      artifact_type: artifact?.artifact_type ?? null,
      record_count: recordCount,
    },
  };
}
