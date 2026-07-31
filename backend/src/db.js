import pg from 'pg';
import { config } from './config.js';

const DEFAULT_PASSWORD_HASH = '$2b$10$v0HS5uGTB5l7JmMqO3kAnuok42ML/Yo.jo8F01/7LFvYreJhhKBfG';

// Pool 是 PostgreSQL 的连接池。
// 后端每次查询数据库时，从连接池里拿一个连接，用完自动归还。
// 连接池比每次请求都重新连接数据库更高效。
export const pool = new pg.Pool({
  connectionString: config.databaseUrl
});

export async function ensureAppSchema() {
  // Docker 命名卷已经存在时，database/schema.sql 不会再次自动执行。
  // 所以后端启动时兜底创建账号相关表，旧环境升级后也能自动补齐新表。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_assignments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      message TEXT NOT NULL DEFAULT '',
      assigned_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      delete_reason TEXT NOT NULL DEFAULT '',
      deleted_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_assignments_user_id_created_at ON user_assignments (user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_assignments_deleted ON user_assignments (is_deleted)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_attachments (
      id SERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_key TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT '',
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_video_attachments_video_id ON video_attachments (video_id)');

  // 管理员至少要有一个，否则后台无法再创建用户或修复数据。
  await pool.query(
    `INSERT INTO admins (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING`,
    ['admin', DEFAULT_PASSWORD_HASH]
  );

  // demo 是本地调试和教学用的普通用户，后续真实用户由管理员在后台创建。
  await pool.query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING`,
    ['demo', DEFAULT_PASSWORD_HASH]
  );
}
