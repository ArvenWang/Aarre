# Aarre encrypted production recovery

`aarre-production-secrets.tar.gz.enc` is an encrypted, offline recovery copy of the production API environment, dedicated CAM credentials, Tencent provisioning state and the production SSH private key. It never contains plaintext secrets in Git.

The bundle uses AES-256-CBC with PBKDF2-SHA256 (600,000 iterations). The passphrase is stored in macOS Keychain under service `com.aarre.production-secrets`, account `recovery-passphrase-v1`; the one-time recovery copy is written to `~/Documents/Aarre-Recovery/` with mode 0600 and must be copied to an offline password vault.

Regenerate and verify the bundle after every credential or KEK rotation:

```bash
server/infra/production/export-encrypted-recovery.sh
```

Validate or recover access without manually handling OpenSSL commands:

```bash
ops/cloud-production/restore-production-access.sh --verify-only
ops/cloud-production/restore-production-access.sh --install-ssh
ops/cloud-production/verify-production-access.sh
```

The passphrase, Tencent/Google interactive account credentials, MFA state, browser cookies and user BYOK API keys are intentionally excluded from Git. See `ops/cloud-production/README.md` for the full access inventory and operational sequence.

Never delete an old KEK version from `AARRE_KEK_KEYRING_JSON` before every `user_keys` row has been rewrapped and a fresh encrypted recovery bundle has been verified.
