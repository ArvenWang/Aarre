CREATE TABLE asset_uploads (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 upload_id uuid NOT NULL, device_id uuid NOT NULL, asset_id uuid NOT NULL,
 base_revision bigint NOT NULL, object_key text NOT NULL UNIQUE,
 metadata jsonb NOT NULL, binding_payload bytea,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
 PRIMARY KEY (user_id, upload_id)
);
CREATE INDEX asset_uploads_expiry_idx ON asset_uploads (expires_at);
CREATE TABLE refresh_recoveries (
 token_hash text PRIMARY KEY REFERENCES refresh_tokens(token_hash) ON DELETE CASCADE,
 operation_id uuid NOT NULL, response_payload bytea NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
