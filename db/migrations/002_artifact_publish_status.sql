ALTER TABLE knowledge_source_artifacts
  ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'imported';
