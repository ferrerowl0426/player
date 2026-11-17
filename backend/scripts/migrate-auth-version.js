// Explicit offline-reviewed migration. NOT imported by server/db startup.
// Usage (after backup, in isolated DB first):
//   node scripts/migrate-auth-version.js --apply
// Uses only DATABASE_URL from the environment; does not load dotenv or db.js.
//
// 作用：为 admins / users 两张表新增 auth_version 列（INTEGER NOT NULL DEFAULT 0）。
// 改密 / 管理重置会原子递增该列，使旧 JWT 立即失效；所有鉴权在每次请求时回查该列
// 并拒绝版本不匹配或缺版本的旧 token。新登录签发的 JWT 携带 authVersion。
//
// 此迁移幂等：ADD COLUMN IF NOT EXISTS，重复执行安全。默认 0 不会令既有会话失效，
// 但会强制所有在途旧 token（未携带 authVersion）在迁移后重新登录。
import { pathToFileURL } from 'node:url';

export const AUTH_VERSION_MIGRATION_SQL = `
SELECT pg_advisory_xact_lock(73281030);
LOCK TABLE admins, users IN ACCESS EXCLUSIVE MODE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
-- 双保险：确保任何未能通过 DEFAULT 落地的历史 NULL 行被修正为 0。
UPDATE admins SET auth_version = 0 WHERE auth_version IS NULL;
UPDATE users SET auth_version = 0 WHERE auth_version IS NULL;
ALTER TABLE admins ALTER COLUMN auth_version SET DEFAULT 0;
ALTER TABLE users ALTER COLUMN auth_version SET DEFAULT 0;
ALTER TABLE admins ALTER COLUMN auth_version SET NOT NULL;
ALTER TABLE users ALTER COLUMN auth_version SET NOT NULL;
`;

export async function migrateAuthVersion(client) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query(AUTH_VERSION_MIGRATION_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
    throw new Error('Explicit --apply required; back up and rehearse in an isolated database first.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (not loaded from files).');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await migrateAuthVersion(client);
    console.log('Auth version migration completed. admins / users now carry auth_version (default 0).');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
