CREATE TABLE account_usage (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  metadata_bytes bigint NOT NULL DEFAULT 0 CHECK (metadata_bytes >= 0),
  asset_bytes bigint NOT NULL DEFAULT 0 CHECK (asset_bytes >= 0),
  asset_count integer NOT NULL DEFAULT 0 CHECK (asset_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO account_usage (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE backup_runs (
  id uuid PRIMARY KEY,
  backup_kind text NOT NULL CHECK (backup_kind IN ('database', 'cos-inventory', 'restore-drill')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  object_key text,
  sha256 text,
  byte_size bigint,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
