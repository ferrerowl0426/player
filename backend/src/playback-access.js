import { canViewPrivate } from './content-visibility.js';
import { canReadContentObject } from './content-object-access.js';

// 视频/转码播放的授权与序列化工具（阶段 E：云端真实访问控制的代码侧兜底）。
//
// 目标：私密视频不再向客户端下发永久公开的 COS/CDN 地址，改由授权端点按需签发
// 短期 COS 签名 URL。公开对象保持现状（永久公开地址 + CDN 播放地址）以兼容现有前端。
//
// 本模块只做“判断 + 序列化”，不自行签名、不解析身份；签名由 storage.createDownloadUrl
// 完成，身份由 auth.optionalContentViewer 注入的 req.contentViewer 提供。

// 视频被多个 P 共用时，任一宿主私密即视为私密（与 canReadContentObject 的 video 分支一致）。
// 返回 true 表示该视频对“非私密查看者”也可公开读取（公开对象）；false 表示需授权才能读取。
export async function isVideoPubliclyReadable(client, videoId) {
  const result = await client.query('SELECT 1 FROM videos WHERE id = $1', [videoId]);
  if (result.rowCount === 0) return false;
  return canReadContentObject(client, 'video', videoId, { role: 'user', status: 'active' });
}

// 批量判断一组视频 ID 中哪些“对公开读取者可公开读取”：任一宿主（track/knowledge P）私密即视为不可公开。
// 与 canReadContentObject 的 video 分支口径一致（NOT EXISTS 私密宿主）。
// 返回 Set<videoId>，仅包含“无任何私密宿主”的视频；用于 tracks / knowledge / 小程序等列表场景，
// 决定非授权查看者是否应抹掉永久播放地址（fail-closed）。
export async function filterPubliclyReadableVideos(client, videoIds) {
  const ids = Array.isArray(videoIds) ? videoIds.filter(Boolean) : [];
  const readable = new Set();
  if (ids.length === 0) return readable;
  const result = await client.query(`
    SELECT DISTINCT s.video_id FROM (
      SELECT video_id FROM track_parts x JOIN track_points c ON c.id = x.track_id
       WHERE x.video_id = ANY($1::int[]) AND (COALESCE(NULLIF(x.visibility, ''), 'public') <> 'public' OR COALESCE(NULLIF(c.visibility, ''), 'public') <> 'public')
      UNION ALL
      SELECT video_id FROM knowledge_parts x JOIN knowledge_points c ON c.id = x.knowledge_point_id
       WHERE x.video_id = ANY($1::int[]) AND (COALESCE(NULLIF(x.visibility, ''), 'public') <> 'public' OR COALESCE(NULLIF(c.visibility, ''), 'public') <> 'public')
    ) s`, [ids]);
  const blocked = new Set(result.rows.map((row) => row.video_id));
  for (const id of ids) {
    if (!blocked.has(id)) readable.add(id);
  }
  return readable;
}

// 私密对象（仅教师/主任可见）才需要短期授权；公开对象无需授权即可直读。
export function needsAuthorization(publiclyReadable, viewer) {
  if (publiclyReadable) return false;
  return canViewPrivate(viewer);
}

// 序列化一个“播放地址”：公开 → 返回永久地址；私密（教师/主任）→ 返回授权端点占位，
// 由前端再请求短期签名；私密（学生/游客）→ 清空（不给任何可播放入口）。
//
// options:
//   publiclyReadable {boolean} 目标是否公开可读
//   viewer             {object}  服务端解析出的身份（req.contentViewer）
//   publicUrl          {string}  永久公开地址（视频原画/转码）
//   playUrl            {string}  永久 CDN 播放地址
//   authorizeEndpoint  {string}  短期授权端点（相对路径），如 /api/playback/videos/1/play-url
export function serializePlaybackTarget({ publiclyReadable, viewer, publicUrl = '', playUrl = '', authorizeEndpoint = '' }) {
  if (publiclyReadable) {
    return { url: publicUrl, playUrl, authorized: false };
  }
  if (canViewPrivate(viewer)) {
    return { url: '', playUrl: '', authorized: true, authorizeEndpoint };
  }
  return { url: '', playUrl: '', authorized: false, authorizeEndpoint: '' };
}
