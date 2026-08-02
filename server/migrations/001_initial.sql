CREATE TABLE users (
  id uuid PRIMARY KEY,
  google_sub_hash text NOT NULL UNIQUE,
  email_hash text NOT NULL,
  profile_payload bytea NOT NULL,
  quota_bytes bigint NOT NULL CHECK (quota_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX users_email_hash_idx ON users (email_hash);

CREATE TABLE user_keys (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wrapped_dek text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('tencent-kms', 'tencent-ssm', 'root-file', 'local-test')),
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE devices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  name_payload bytea,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE token_families (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replay_detected_at timestamptz,
  FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, device_id) ON DELETE CASCADE
);

CREATE TABLE access_tokens (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES token_families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX access_tokens_user_idx ON access_tokens (user_id, expires_at);

CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES token_families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by_hash text
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id, expires_at);

CREATE TABLE oauth_requests (
  state_hash text PRIMARY KEY,
  nonce_hash text NOT NULL,
  code_challenge text NOT NULL,
  device_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE auth_tickets (
  ticket_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  code_challenge text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE resources (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  payload bytea NOT NULL,
  field_clocks jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  PRIMARY KEY (user_id, resource_key)
);

CREATE INDEX resources_updated_idx ON resources (user_id, updated_at DESC);
CREATE INDEX resources_recycle_idx ON resources (purge_after) WHERE deleted_at IS NOT NULL;

CREATE TABLE bookmark_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookmark_item_id uuid NOT NULL,
  resource_key text NOT NULL,
  payload bytea NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, bookmark_item_id)
);

CREATE INDEX bookmark_items_resource_idx ON bookmark_items (user_id, resource_key);

CREATE TABLE protection_rules (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  protection_rule_id uuid NOT NULL,
  rule_kind text NOT NULL CHECK (rule_kind IN ('resource', 'folder')),
  resource_key text,
  payload bytea,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, protection_rule_id),
  CHECK (
    (rule_kind = 'resource' AND resource_key IS NOT NULL) OR
    (rule_kind = 'folder' AND payload IS NOT NULL)
  )
);

CREATE UNIQUE INDEX protection_resource_unique_idx
  ON protection_rules (user_id, resource_key)
  WHERE rule_kind = 'resource' AND deleted_at IS NULL;

CREATE TABLE user_settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  payload bytea NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, setting_key)
);

CREATE TABLE conversations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  payload bytea NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE TABLE reports (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL,
  report_kind text NOT NULL,
  payload bytea NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, report_id)
);

CREATE TABLE usage_periods (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  payload bytea NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period, provider, model)
);

CREATE TABLE operation_history (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_kind text NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, operation_id)
);

CREATE INDEX operation_history_expiry_idx ON operation_history (expires_at);

CREATE TABLE assets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  resource_key text NOT NULL,
  asset_kind text NOT NULL CHECK (asset_kind IN ('cover', 'snapshot', 'site-icon', 'user-cover')),
  object_key text NOT NULL UNIQUE,
  cos_version_id text,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  mime_type text NOT NULL,
  captured_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting', 'deleted', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, asset_id)
);

CREATE INDEX assets_resource_idx ON assets (user_id, resource_key, asset_kind);
CREATE INDEX assets_stale_upload_idx ON assets (created_at) WHERE state = 'uploading';

CREATE TABLE asset_delete_jobs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  object_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE sync_changes (
  sequence bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  revision bigint NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_changes_user_sequence_idx ON sync_changes (user_id, sequence);

CREATE TABLE sync_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id_hash text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_user_created_idx ON audit_events (user_id, created_at DESC);
