ALTER TABLE user_keys
  DROP CONSTRAINT IF EXISTS user_keys_provider_check;

ALTER TABLE user_keys
  ADD CONSTRAINT user_keys_provider_check
  CHECK (provider IN ('tencent-kms', 'tencent-ssm', 'root-file', 'local-test'));
