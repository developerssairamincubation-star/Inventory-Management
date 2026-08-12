-- Identity & access: departments, users, sessions (refresh-token store).

CREATE TABLE departments (
  department_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department_name VARCHAR(150) NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- users.password_hash holds a bcrypt hash (JWT/email+password auth, no external IdP).
CREATE TABLE users (
  user_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  full_name     VARCHAR(200) NOT NULL,
  department_id UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  role          TEXT         NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'user')),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_department ON users(department_id);

-- Refresh-token store. token_hash is SHA-256 of the raw refresh token; the raw
-- value only ever lives in the client's httpOnly cookie, never at rest here.
-- replaced_by chains rotated tokens together so reuse of an already-rotated
-- token can be detected and the whole chain revoked (refresh-token theft signal).
CREATE TABLE sessions (
  session_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  replaced_by   UUID        REFERENCES sessions(session_id),
  user_agent    TEXT,
  ip_address    INET,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sessions_token_hash  ON sessions(token_hash);
CREATE INDEX idx_sessions_user_id            ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at         ON sessions(expires_at);

-- Password-reset flow (replaces Firebase's hosted reset email).
CREATE TABLE password_reset_tokens (
  token_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_password_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_user_id           ON password_reset_tokens(user_id);
