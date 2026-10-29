import { getKeyFromPublicUrl } from './storage.js';

// 阶段 E：旧直链撤销清单（E04）。
//
// 当内容从公开变为私密（P 改私密、删除最后公开 P 导致课程转私密）时，此前已下发的
// 永久公开 COS/CDN 地址仍然可匿名访问。云端匿名读与 CDN 缓存无法由应用代码直接回收，
// 但必须把“需要撤销的 key”记录到 visibility_revocations 表，供账号所有者在腾讯云
// 控制台/脚本执行 CDN purge 与桶授权回收，并在处理后回写 status=revoked。
//
// 本模块只记录，不自动改云端策略；真正私密依赖阶段 E 的云端配置验收。

// 从数据库行里收集需要撤销的对象 key（去重、过滤空值）。
// rows 形如 [{ video_url, cover_url, file_key }]，可能来自 videos / video_renditions / attachments。
export function collectRevocationKeys(rows = []) {
  const keys = new Set();
  for (const row of rows) {
    for (const value of [row.video_url, row.cover_url, row.file_url, row.file_key]) {
      if (!value) continue;
      // file_key 可能已是 key（attachments/ 前缀），video_url/cover_url 是完整公开地址。
      const key = value.includes('://') ? getKeyFromPublicUrl(value) : value;
      if (key && !key.includes('..')) keys.add(key);
    }
  }
  return [...keys];
}

// 查询一个视频的所有对象 key（原画 + 全部转码 + 封面）。
export async function getVideoObjectKeys(client, videoId, { includeCover = true } = {}) {
  const videoResult = await client.query('SELECT video_url, cover_url FROM videos WHERE id = $1', [videoId]);
  const renditionResult = await client.query(
    "SELECT video_url FROM video_renditions WHERE video_id = $1 AND video_url <> ''",
    [videoId]
  );
  const rows = [
    ...videoResult.rows,
    ...(includeCover ? videoResult.rows : []),
    ...renditionResult.rows
  ];
  return collectRevocationKeys(rows);
}

// 把一次改私密/删 P 产生的待撤销 key 写入审计表（在调用方事务内执行）。
export async function recordVisibilityRevocations(client, { objectType, objectId, keys, reason = '', adminId = null }) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return 0;
  for (const key of unique) {
    await client.query(
      `INSERT INTO visibility_revocations (object_type, object_id, object_key, reason, admin_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [objectType, objectId, key, reason, adminId]
    );
  }
  return unique.length;
}
