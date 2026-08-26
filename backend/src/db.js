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
      role VARCHAR(20) NOT NULL DEFAULT 'teacher',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE admins
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'teacher'
  `);

  await pool.query(`
    UPDATE admins
    SET role = 'super_admin'
    WHERE username = 'admin'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teaching_classes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      teacher_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      class_id INTEGER REFERENCES teaching_classes(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES teaching_classes(id) ON DELETE SET NULL
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_class_id ON users (class_id)');

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

  await pool.query('CREATE SEQUENCE IF NOT EXISTS user_assignments_operation_id_seq');

  await pool.query(`
    ALTER TABLE user_assignments
    ADD COLUMN IF NOT EXISTS operation_id INTEGER
  `);

  await pool.query(`
    UPDATE user_assignments
    SET operation_id = nextval('user_assignments_operation_id_seq')
    WHERE operation_id IS NULL
  `);

  await pool.query(`
    ALTER TABLE user_assignments
    ALTER COLUMN operation_id SET NOT NULL
  `);

  await pool.query(`
    ALTER TABLE user_assignments
    ALTER COLUMN operation_id SET DEFAULT nextval('user_assignments_operation_id_seq')
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
    `INSERT INTO admins (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    ['admin', DEFAULT_PASSWORD_HASH, 'super_admin']
  );

  // 初始化教导主任账号。
  await pool.query(
    `INSERT INTO admins (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    ['director', DEFAULT_PASSWORD_HASH, 'super_admin']
  );

  // 初始化两位老师。
  await pool.query(
    `INSERT INTO admins (username, password_hash, role)
     VALUES ($1, $2, $3), ($4, $5, $6)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    ['teacher_a', DEFAULT_PASSWORD_HASH, 'teacher', 'teacher_b', DEFAULT_PASSWORD_HASH, 'teacher']
  );

  // 初始化两个班级（一班、二班），分别分配给两位老师。
  await pool.query(
    `INSERT INTO teaching_classes (name, teacher_id)
     SELECT '一班', id FROM admins WHERE username = 'teacher_a'
     ON CONFLICT DO NOTHING`
  );

  await pool.query(
    `INSERT INTO teaching_classes (name, teacher_id)
     SELECT '二班', id FROM admins WHERE username = 'teacher_b'
     ON CONFLICT DO NOTHING`
  );

  // 初始化一班三位学员。
  await pool.query(
    `INSERT INTO users (username, password_hash, class_id)
     VALUES
       ('student_a1', $1, (SELECT id FROM teaching_classes WHERE name = '一班')),
       ('student_a2', $1, (SELECT id FROM teaching_classes WHERE name = '一班')),
       ('student_a3', $1, (SELECT id FROM teaching_classes WHERE name = '一班'))
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, class_id = EXCLUDED.class_id`,
    [DEFAULT_PASSWORD_HASH]
  );

  // 初始化二班三位学员。
  await pool.query(
    `INSERT INTO users (username, password_hash, class_id)
     VALUES
       ('student_b1', $1, (SELECT id FROM teaching_classes WHERE name = '二班')),
       ('student_b2', $1, (SELECT id FROM teaching_classes WHERE name = '二班')),
       ('student_b3', $1, (SELECT id FROM teaching_classes WHERE name = '二班'))
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, class_id = EXCLUDED.class_id`,
    [DEFAULT_PASSWORD_HASH]
  );

  // 确保所有没有班级的学员都被归入第一个班级，避免游离数据。
  await pool.query(`
    UPDATE users
    SET class_id = (SELECT id FROM teaching_classes ORDER BY id LIMIT 1)
    WHERE class_id IS NULL
  `);
}
