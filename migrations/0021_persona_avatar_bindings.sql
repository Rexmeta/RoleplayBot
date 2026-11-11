CREATE TABLE IF NOT EXISTS persona_avatar_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_scope varchar(150) NOT NULL,
  provider_id varchar(100) NOT NULL,
  source_image_hash varchar(64) NOT NULL,
  router_asset_id varchar(200),
  provider_avatar_id varchar(200),
  status varchar(20) DEFAULT 'not_created' NOT NULL,
  failure_code varchar(100),
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT persona_avatar_assets_source_hash_check CHECK (source_image_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT persona_avatar_assets_status_check CHECK (status IN ('not_created', 'pending', 'ready', 'failed')),
  CONSTRAINT persona_avatar_assets_failure_code_check CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS persona_avatar_asset_scope_provider_hash_unique
  ON persona_avatar_assets (tenant_scope, provider_id, source_image_hash);

CREATE TABLE IF NOT EXISTS persona_avatar_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_scope varchar(150) NOT NULL,
  persona_type varchar(20) NOT NULL,
  persona_id varchar(150) NOT NULL,
  provider_id varchar(100) NOT NULL,
  asset_id uuid NOT NULL REFERENCES persona_avatar_assets(id) ON DELETE RESTRICT,
  source_image_hash varchar(64) NOT NULL,
  source_image_version integer NOT NULL,
  status varchar(20) DEFAULT 'not_created' NOT NULL,
  rights_status varchar(20) DEFAULT 'unverified' NOT NULL,
  likeness varchar(20),
  consent_reference varchar(200),
  reviewed_by varchar(150),
  reviewed_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT persona_avatar_bindings_persona_type_check CHECK (persona_type IN ('mbti', 'user')),
  CONSTRAINT persona_avatar_bindings_source_hash_check CHECK (source_image_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT persona_avatar_bindings_version_check CHECK (source_image_version > 0),
  CONSTRAINT persona_avatar_bindings_status_check CHECK (status IN ('not_created', 'pending', 'ready', 'failed', 'stale')),
  CONSTRAINT persona_avatar_bindings_rights_status_check CHECK (rights_status IN ('unverified', 'pending_review', 'approved', 'rejected')),
  CONSTRAINT persona_avatar_bindings_likeness_check CHECK (likeness IS NULL OR likeness IN ('synthetic', 'real_person')),
  CONSTRAINT persona_avatar_bindings_approved_rights_check CHECK (rights_status <> 'approved' OR (
    likeness IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
    AND (likeness <> 'real_person' OR consent_reference IS NOT NULL)
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS persona_avatar_binding_version_unique
  ON persona_avatar_bindings (tenant_scope, persona_type, persona_id, provider_id, source_image_version);

CREATE INDEX IF NOT EXISTS persona_avatar_binding_persona_lookup
  ON persona_avatar_bindings (tenant_scope, persona_type, persona_id, provider_id);
