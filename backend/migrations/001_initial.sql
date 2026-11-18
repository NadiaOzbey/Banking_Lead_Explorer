CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'client'))
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE profiles (
  id text PRIMARY KEY,
  name text NOT NULL,
  region text NOT NULL,
  sector text NOT NULL,
  signal text NOT NULL,
  details jsonb NOT NULL
);

CREATE TABLE assignments (
  user_id uuid REFERENCES users ON DELETE CASCADE,
  profile_id text REFERENCES profiles ON DELETE CASCADE,
  PRIMARY KEY (user_id, profile_id)
);

CREATE TABLE access_codes (
  code_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  redeemed_at timestamptz
);

CREATE TABLE access_code_profiles (
  code_hash text REFERENCES access_codes ON DELETE CASCADE,
  profile_id text REFERENCES profiles ON DELETE CASCADE,
  PRIMARY KEY (code_hash, profile_id)
);
