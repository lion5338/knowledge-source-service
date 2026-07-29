CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS knowledge_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL UNIQUE,
  display_name text NOT NULL,
  repo_url text,
  license text,
  license_scope text,
  attribution text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL REFERENCES knowledge_source_registry(source) ON DELETE CASCADE,
  source_version text NOT NULL,
  snapshot_status text NOT NULL DEFAULT 'available',
  storage_driver text NOT NULL DEFAULT 'local',
  raw_root text,
  snapshot_path text,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_bytes bigint NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_version)
);

CREATE TABLE IF NOT EXISTS knowledge_source_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id text NOT NULL UNIQUE,
  artifact_type text NOT NULL,
  source text,
  source_version text,
  storage_path text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/json',
  publish_status text NOT NULL DEFAULT 'imported',
  record_count integer,
  checksum_sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  target_type text NOT NULL,
  target_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source_versions_source ON knowledge_source_versions(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_artifacts_type ON knowledge_source_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_artifacts_source ON knowledge_source_artifacts(source, source_version);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_audit_target ON knowledge_source_audit_events(target_type, target_id);
