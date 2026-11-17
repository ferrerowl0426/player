import { Router } from 'express';
import { pool } from './db.js';
import { optionalContentViewer } from './auth.js';
import { getPublicUrl, getKeyFromPublicUrl } from './storage.js';
import { isVideoPubliclyReadable } from './playback-access.js';
import { canViewPrivate } from './content-visibility.js';
import { toPlaybackUrl } from './playback-url.js';

// 视频/转码播放的授权端点（阶段 E）。
// 可见性仅为业务展示（阶段 A/B 已是实际文件）：私密视频不再下发强签名短链，授权用户
// （教师/主任）直接返回经 CDN 转换后的原 COS 公开播放地址；未授权用户（学生/游客）
// 访问私密视频统一 404，不泄露存在性。公开对象保持 CDN 播放地址以兼容现有前端。
export const playbackRouter = Router();

const VALID_QUALITIES = new Set(['source', '720p', '1080p']);
const VALID_SOURCES = new Set(['video', 'rendition']);

// 把存储里的完整公开地址还原成对象 key（复用 storage.getKeyFromPublicUrl）。
async function handlePlayUrl(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.vary('Cookie');

  const id = Number(req.params.id);
  const source = String(req.query.source || 'video');
  const quality = String(req.query.quality || 'source');

  if (!Number.isSafeInteger(id) || id <= 0 || !VALID_SOURCES.has(source) || !VALID_QUALITIES.has(quality)) {
    res.status(400).json({ message: '参数无效' });
    return;
  }

  let key = '';
  try {
    // 反查视频是否公开可读；公开对象也允许通过本端点取签名（保持行为一致），
    // 但私密对象必须走授权。
    const publiclyReadable = await isVideoPubliclyReadable(pool, id);
    if (!publiclyReadable && !canViewPrivate(req.contentViewer)) {
      // 学生/游客访问私密视频：统一 404，不泄露存在性（fail-closed）。
      res.status(404).json({ message: '视频不存在或无权访问' });
      return;
    }

    if (source === 'rendition') {
      const result = await pool.query(
        `SELECT video_url FROM video_renditions WHERE video_id = $1 AND quality = $2 AND status = 'ready' AND video_url <> '' LIMIT 1`,
        [id, quality]
      );
      if (result.rowCount === 0) {
        res.status(404).json({ message: '清晰度不存在或未就绪' });
        return;
      }
      key = getKeyFromPublicUrl(result.rows[0].video_url);
    } else {
      const result = await pool.query('SELECT video_url FROM videos WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        res.status(404).json({ message: '视频不存在' });
        return;
      }
      key = getKeyFromPublicUrl(result.rows[0].video_url);
    }
  } catch (error) {
    next(error);
    return;
  }

  if (!key) {
    res.status(404).json({ message: '视频不存在或无权访问' });
    return;
  }

  try {
    // 可见性仅为业务展示：授权用户（含公开对象）统一返回经 CDN 转换的播放地址，
    // 不再签发 COS 私有读短链或附加 TypeA 签名。
    const url = toPlaybackUrl(getPublicUrl(key));
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.json({ data: { id, source, quality, url } });
  } catch {
    // 地址生成失败：返回通用错误，不暴露底层存储错误。
    res.status(500).json({ message: '播放地址生成失败' });
  }
}

playbackRouter.get('/videos/:id/play-url', optionalContentViewer, handlePlayUrl);
playbackRouter.head('/videos/:id/play-url', optionalContentViewer, handlePlayUrl);
