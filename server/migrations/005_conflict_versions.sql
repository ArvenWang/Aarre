CREATE TABLE conflict_versions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conflict_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('resource')),
  entity_id text NOT NULL,
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  server_revision bigint NOT NULL CHECK (server_revision > 0),
  payload bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution text CHECK (resolution IN ('current', 'incoming', 'merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (user_id, conflict_id)
);

CREATE INDEX conflict_versions_pending_idx
  ON conflict_versions (user_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX conflict_versions_entity_idx
  ON conflict_versions (user_id, entity_type, entity_id, created_at DESC);
