import pg from 'pg';
import { config } from './config.js';

const DEFAULT_PASSWORD_HASH = '$2b$10$WIZqC5E5V1U5Q/52CpY0h.KT25NEQXksDBStnUaXbydcn5cqvaPxm';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl
});

async function addColumnIfMissing(tableName, columnSql) {
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnSql}`);
}

async function seedAdmin({ username, role }) {
  await pool.query(
    `INSERT INTO admins (username, account, nickname, password_hash, role, status)
     VALUES ($1, $1, $1, $2, $3, 'active')
     ON CONFLICT (username) DO UPDATE SET
       account = EXCLUDED.account,
       nickname = EXCLUDED.nickname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status`,
    [username, DEFAULT_PASSWORD_HASH, role]
  );
}

async function seedUser({ username, className }) {
  await pool.query(
    `INSERT INTO users (username, account, nickname, password_hash, class_id, status, is_active)
     VALUES ($1, $1, $1, $2, (SELECT id FROM teaching_classes WHERE name = $3), 'active', TRUE)
     ON CONFLICT (username) DO UPDATE SET
       account = EXCLUDED.account,
       nickname = EXCLUDED.nickname,
       password_hash = EXCLUDED.password_hash,
       class_id = EXCLUDED.class_id,
       status = EXCLUDED.status,
       is_active = EXCLUDED.is_active`,
    [username, DEFAULT_PASSWORD_HASH, className]
  );
}

export async function ensureAppSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      video_url TEXT NOT NULL,
      cover_url TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_title ON videos (title)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_renditions (
      id SERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      quality VARCHAR(20) NOT NULL,
      video_url TEXT NOT NULL DEFAULT '',
      file_size BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'processing',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (video_id, quality)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_video_renditions_video_id ON video_renditions (video_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_video_renditions_status ON video_renditions (status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      account VARCHAR(50) UNIQUE,
      nickname VARCHAR(50) NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'teacher',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing('admins', "account VARCHAR(50) UNIQUE");
  await addColumnIfMissing('admins', "nickname VARCHAR(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing('admins', "role VARCHAR(20) NOT NULL DEFAULT 'teacher'");
  await addColumnIfMissing('admins', "status VARCHAR(20) NOT NULL DEFAULT 'active'");
  await pool.query("UPDATE admins SET account = username WHERE account IS NULL OR account = ''");
  await pool.query("UPDATE admins SET nickname = username WHERE nickname = ''");
  await pool.query("UPDATE admins SET status = 'active' WHERE status IS NULL OR status = ''");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admins_account ON admins (account)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admins_role ON admins (role)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admins_status ON admins (status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teaching_classes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      teacher_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      account VARCHAR(50) UNIQUE,
      nickname VARCHAR(50) NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      class_id INTEGER REFERENCES teaching_classes(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing('users', "account VARCHAR(50) UNIQUE");
  await addColumnIfMissing('users', "nickname VARCHAR(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing('users', 'class_id INTEGER REFERENCES teaching_classes(id) ON DELETE SET NULL');
  await addColumnIfMissing('users', "status VARCHAR(20) NOT NULL DEFAULT 'active'");
  await addColumnIfMissing('users', 'is_active BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query("UPDATE users SET account = username WHERE account IS NULL OR account = ''");
  await pool.query("UPDATE users SET nickname = username WHERE nickname = ''");
  await pool.query("UPDATE users SET status = CASE WHEN is_active THEN 'active' ELSE 'disabled' END WHERE status = '' OR status IS NULL");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_account ON users (account)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_class_id ON users (class_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_classes (
      teacher_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES teaching_classes(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (teacher_id, class_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_teacher_classes_class_id ON teacher_classes (class_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_assignments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      object_type VARCHAR(30) NOT NULL DEFAULT 'video',
      object_id INTEGER,
      message TEXT NOT NULL DEFAULT '',
      assigned_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      delete_reason TEXT NOT NULL DEFAULT '',
      deleted_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE SEQUENCE IF NOT EXISTS user_assignments_operation_id_seq');
  await addColumnIfMissing('user_assignments', 'operation_id INTEGER');
  await pool.query("UPDATE user_assignments SET operation_id = nextval('user_assignments_operation_id_seq') WHERE operation_id IS NULL");
  await pool.query('ALTER TABLE user_assignments ALTER COLUMN operation_id SET NOT NULL');
  await pool.query("ALTER TABLE user_assignments ALTER COLUMN operation_id SET DEFAULT nextval('user_assignments_operation_id_seq')");
  await addColumnIfMissing('user_assignments', "assigned_video_title TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('user_assignments', "object_type VARCHAR(30) NOT NULL DEFAULT 'video'");
  await addColumnIfMissing('user_assignments', 'object_id INTEGER');
  await addColumnIfMissing('user_assignments', 'part_id INTEGER');
  await addColumnIfMissing('user_assignments', "assigned_object_title TEXT NOT NULL DEFAULT ''");
  await pool.query("UPDATE user_assignments SET assigned_video_title = v.title FROM videos v WHERE user_assignments.video_id = v.id AND user_assignments.assigned_video_title = ''");
  await pool.query("UPDATE user_assignments SET object_type = 'video', object_id = video_id WHERE object_id IS NULL AND video_id IS NOT NULL");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_assignments_user_id_created_at ON user_assignments (user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_assignments_deleted ON user_assignments (is_deleted)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_assignments_object ON user_assignments (object_type, object_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_points (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_points_updated_at ON track_points (updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_points_name ON track_points (name)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_collections (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_collections_updated_at ON track_collections (updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_collections_name ON track_collections (name)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_parts (
      id SERIAL PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES track_points(id) ON DELETE CASCADE,
      part_no INTEGER NOT NULL DEFAULT 1,
      video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      title VARCHAR(120) NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (track_id, part_no)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_parts_track_id_part_no ON track_parts (track_id, part_no)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_collection_items (
      collection_id INTEGER NOT NULL REFERENCES track_collections(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES track_points(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, track_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_track_collection_items_track_id ON track_collection_items (track_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_points (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_points_updated_at ON knowledge_points (updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_points_name ON knowledge_points (name)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_collections (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_collections_updated_at ON knowledge_collections (updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_collections_name ON knowledge_collections (name)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_parts (
      id SERIAL PRIMARY KEY,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
      part_no INTEGER NOT NULL DEFAULT 1,
      video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      title VARCHAR(120) NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (knowledge_point_id, part_no)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_parts_kp_id_part_no ON knowledge_parts (knowledge_point_id, part_no)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_collection_items (
      collection_id INTEGER NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, knowledge_point_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_collection_items_kp_id ON knowledge_collection_items (knowledge_point_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_attachments (
      id SERIAL PRIMARY KEY,
      object_type VARCHAR(30) NOT NULL,
      object_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_key TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT '',
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_content_attachments_object ON content_attachments (object_type, object_id)');

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS library_resources (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_key TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT '',
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_library_resources_updated_at ON library_resources (updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_library_resources_title ON library_resources (title)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS library_resource_links (
      library_resource_id INTEGER NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,
      object_type VARCHAR(30) NOT NULL,
      object_id INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (library_resource_id, object_type, object_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_library_resource_links_object ON library_resource_links (object_type, object_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prerequisites (
      object_type VARCHAR(30) NOT NULL,
      object_id INTEGER NOT NULL,
      prerequisite_type VARCHAR(30) NOT NULL,
      prerequisite_id INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (object_type, object_id, prerequisite_type, prerequisite_id),
      CONSTRAINT prerequisites_no_self CHECK (object_type <> prerequisite_type OR object_id <> prerequisite_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_prerequisites_object ON prerequisites (object_type, object_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_prerequisites_prerequisite ON prerequisites (prerequisite_type, prerequisite_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deletion_logs (
      id SERIAL PRIMARY KEY,
      object_type VARCHAR(30) NOT NULL,
      object_id INTEGER NOT NULL,
      object_title TEXT NOT NULL DEFAULT '',
      admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deletion_logs_object ON deletion_logs (object_type, object_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deletion_logs_created_at ON deletion_logs (created_at DESC)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_prerequisites (
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      prerequisite_video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (video_id, prerequisite_video_id),
      CONSTRAINT video_prerequisites_no_self CHECK (video_id <> prerequisite_video_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_video_prerequisites_video_id ON video_prerequisites (video_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_video_prerequisites_prerequisite_id ON video_prerequisites (prerequisite_video_id)');

  await seedAdmin({ username: 'admin', role: 'super_admin' });
  await seedAdmin({ username: 'teacher_a', role: 'teacher' });
  await seedAdmin({ username: 'teacher_b', role: 'teacher' });

  await pool.query(`
    INSERT INTO teaching_classes (name, teacher_id)
    SELECT '一班', id FROM admins WHERE username = 'teacher_a'
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO teaching_classes (name, teacher_id)
    SELECT '二班', id FROM admins WHERE username = 'teacher_b'
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO teacher_classes (teacher_id, class_id)
    SELECT a.id, c.id FROM admins a, teaching_classes c
    WHERE a.username = 'teacher_a' AND c.name = '一班'
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO teacher_classes (teacher_id, class_id)
    SELECT a.id, c.id FROM admins a, teaching_classes c
    WHERE a.username = 'teacher_b' AND c.name = '二班'
    ON CONFLICT DO NOTHING
  `);

  await seedUser({ username: 'student_a1', className: '一班' });
  await seedUser({ username: 'student_a2', className: '一班' });
  await seedUser({ username: 'student_a3', className: '一班' });
  await seedUser({ username: 'student_b1', className: '二班' });
  await seedUser({ username: 'student_b2', className: '二班' });
  await seedUser({ username: 'student_b3', className: '二班' });
}
