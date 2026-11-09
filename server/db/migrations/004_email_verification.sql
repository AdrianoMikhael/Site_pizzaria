ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS return_path TEXT NOT NULL DEFAULT '/';

CREATE INDEX IF NOT EXISTS email_verification_user_idx
  ON email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS email_verification_expiry_idx
  ON email_verification_tokens(expires_at);
