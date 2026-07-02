import pg from 'pg';
import { config } from './config.js';

// Pool 是 PostgreSQL 的连接池。
// 后端每次查询数据库时，从连接池里拿一个连接，用完自动归还。
// 连接池比每次请求都重新连接数据库更高效。
export const pool = new pg.Pool({
  connectionString: config.databaseUrl
});
