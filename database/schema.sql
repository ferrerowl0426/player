-- videos 表用来保存视频的基本信息。
-- 真正的视频文件和封面图片不会存进数据库，而是存进 MinIO/S3 存储桶。
-- 数据库只保存文件 URL，这样数据库更轻，文件也更适合走对象存储。
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 按创建时间建索引，首页列表通常按最新视频排序。
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);
