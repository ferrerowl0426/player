-- videos 表用来保存视频的基本信息。
-- 真正的视频文件和封面图片不会存进数据库，而是存进腾讯云 COS / S3 兼容对象存储。
-- 数据库只保存文件 URL，这样数据库更轻，文件也更适合走对象存储。
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 管理员表。当前项目只需要一个管理员，不提供注册功能。
-- password_hash 保存 bcrypt hash，不保存明文密码。
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 初始化唯一管理员：admin / 123456。
-- ON CONFLICT 可以避免容器重复初始化或手动重复执行 SQL 时报错。
INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2b$10$v0HS5uGTB5l7JmMqO3kAnuok42ML/Yo.jo8F01/7LFvYreJhhKBfG')
ON CONFLICT (username) DO NOTHING;

-- 按创建时间建索引，首页列表通常按最新视频排序。
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);

-- 搜索标题和简介时会用到。基础版先用 ILIKE，后续数据量大再升级全文索引。
CREATE INDEX IF NOT EXISTS idx_videos_title ON videos (title);
