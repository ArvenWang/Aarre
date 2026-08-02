CREATE TABLE protection_rule_resources (
  user_id uuid NOT NULL,
  protection_rule_id uuid NOT NULL,
  resource_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, protection_rule_id, resource_key),
  FOREIGN KEY (user_id, protection_rule_id)
    REFERENCES protection_rules (user_id, protection_rule_id)
    ON DELETE CASCADE
);
