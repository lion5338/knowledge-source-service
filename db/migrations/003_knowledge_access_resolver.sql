CREATE TABLE IF NOT EXISTS knowledge_source_tenants (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_users (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  external_subject text,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_api_keys (
  key_id text PRIMARY KEY,
  key_hash_sha256 text NOT NULL UNIQUE,
  key_prefix text,
  tenant_id text REFERENCES knowledge_source_tenants(tenant_id),
  user_id text REFERENCES knowledge_source_users(user_id),
  key_type text NOT NULL DEFAULT 'tenant' CHECK (key_type IN ('service', 'tenant', 'user')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'deleted')),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_collection_entitlements (
  entitlement_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  user_id text REFERENCES knowledge_source_users(user_id),
  collection_id text NOT NULL,
  access_level text NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'admin')),
  enabled boolean NOT NULL DEFAULT true,
  source_type text NOT NULL DEFAULT 'shared' CHECK (source_type IN ('shared', 'tenant_uploaded', 'system_default')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_tenant_collections (
  collection_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  owner_user_id text REFERENCES knowledge_source_users(user_id),
  display_name text NOT NULL,
  collection_type text NOT NULL DEFAULT 'tenant_documents',
  source_family text NOT NULL DEFAULT 'tenant_upload',
  license_scope text NOT NULL DEFAULT 'tenant_private',
  visibility text NOT NULL DEFAULT 'tenant_only' CHECK (visibility IN ('tenant_only', 'user_only', 'shared_with_tenant')),
  ingest_status text NOT NULL DEFAULT 'planned',
  snapshot_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_source_access_audit_events (
  event_id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  tenant_id text,
  user_id text,
  key_id text,
  request_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source_users_tenant ON knowledge_source_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_api_keys_hash_active ON knowledge_source_api_keys(key_hash_sha256, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_api_keys_tenant ON knowledge_source_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_collection_entitlements_tenant ON knowledge_source_collection_entitlements(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_collection_entitlements_collection ON knowledge_source_collection_entitlements(collection_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_collection_entitlements_tenant_unique
  ON knowledge_source_collection_entitlements(tenant_id, collection_id)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_collection_entitlements_user_unique
  ON knowledge_source_collection_entitlements(tenant_id, user_id, collection_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_source_tenant_collections_tenant ON knowledge_source_tenant_collections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_access_audit_events_tenant ON knowledge_source_access_audit_events(tenant_id, created_at);
