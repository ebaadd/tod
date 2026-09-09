import { pg } from "./storage.js";
import { initializeGroups } from "./groups.js";

// Shared by the local setup script and the deployed migration function, so
// both environments get an identical schema.
export async function createSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id uuid PRIMARY KEY,
      name varchar(80) NOT NULL,
      username varchar(30) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash char(64) PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiry_idx
      ON sessions(expires_at);
  `);

  await initializeGroups();
}
