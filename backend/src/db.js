import pg from 'pg';
import { config } from './config.js';

// Pool 是 PostgreSQL 的连接池。
// 后端每次查询数据库时，从连接池里拿一个连接，用完自动归还。
// 连接池比每次请求都重新连接数据库更高效。
export const pool = new pg.Pool({
  connectionString: config.databaseUrl
});

// Docker 命名卷已经存在时，database/schema.sql 不会再次自动执行。
// 所以后端启动时再兜底创建管理员表和默认管理员，保证旧环境升级后也能登录。
export async function ensureAdminSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(
    `INSERT INTO admins (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING`,
    ['admin', '$2b$10$v0HS5uGTB5l7JmMqO3kAnuok42ML/Yo.jo8F01/7LFvYreJhhKBfG']
  );
}
