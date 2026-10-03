import crypto from 'node:crypto';
import { pool } from './db.js';
import { deleteFromBucket, getKeyFromPublicUrl } from './storage.js';

const READY_STATUS = 'ready';
const PROCESSING_STATUS = 'processing';
const FAILED_STATUS = 'failed';
const TRANSCODE_QUALITIES = ['1080p', '720p'];
const ALLOWED_STATUSES = new Set([READY_STATUS, PROCESSING_STATUS, FAILED_STATUS]);

// 数据万象工作流把转码结果写到这个前缀下（控制台里节点的“目标路径”）。
// 回调里的产物 key 必须落在这个前缀内，避免伪造回调把地址指向任意位置。
export const CI_OUTPUT_PREFIX = 'transcoded/';
const CI_SUCCESS_STATE = 'success';

function normalizeQuality(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  const status = String(value ?? '').trim();
  return ALLOWED_STATUSES.has(status) ? status : '';
}

export async function createInitialRenditions(client, { videoId, sourceUrl, sourceSize = 0 }) {
  await client.query(
    `INSERT INTO video_renditions (video_id, quality, video_url, file_size, status)
     VALUES ($1, 'source', $2, $3, 'ready')
     ON CONFLICT (video_id, quality) DO UPDATE SET
       video_url = EXCLUDED.video_url,
       file_size = EXCLUDED.file_size,
       status = EXCLUDED.status,
       updated_at = CURRENT_TIMESTAMP`,
    [videoId, sourceUrl, Number(sourceSize) || 0]
  );

  for (const quality of TRANSCODE_QUALITIES) {
    await client.query(
      `INSERT INTO video_renditions (video_id, quality, video_url, file_size, status)
       VALUES ($1, $2, '', 0, 'processing')
       ON CONFLICT (video_id, quality) DO NOTHING`,
      [videoId, quality]
    );
  }
}

export async function upsertRendition({ videoId, quality, status, videoUrl = '', fileSize = 0 }) {
  const normalizedQuality = normalizeQuality(quality);
  const normalizedStatus = normalizeStatus(status);

  if (!videoId || !['source', ...TRANSCODE_QUALITIES].includes(normalizedQuality) || !normalizedStatus) {
    return false;
  }

  const videoResult = await pool.query('SELECT id FROM videos WHERE id = $1', [videoId]);
  if (videoResult.rowCount === 0) {
    return false;
  }

  await pool.query(
    `INSERT INTO video_renditions (video_id, quality, video_url, file_size, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (video_id, quality) DO UPDATE SET
       video_url = EXCLUDED.video_url,
       file_size = EXCLUDED.file_size,
       status = EXCLUDED.status,
       updated_at = CURRENT_TIMESTAMP`,
    [videoId, normalizedQuality, videoUrl, Number(fileSize) || 0, normalizedStatus]
  );

  return true;
}

function toText(value) {
  return String(value ?? '').trim();
}

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function decodeObjectKey(value) {
  const raw = toText(value);
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// 数据万象任务完成回调的报文在不同入口下结构略有差异：
// 有的把内容包在 Response 下面，有的直接平铺；JobsDetail 可能是对象也可能是数组。
// 所以这里做宽松解析，只挑我们需要的字段，解析不出来的一律留空。
export function parseCiCallbackPayload(payload) {
  const container = payload && typeof payload === 'object' ? (payload.Response || payload.response || payload) : {};
  const root = container && typeof container === 'object' ? container : {};
  const jobs = root.JobsDetail ?? root.jobsDetail;
  const job = Array.isArray(jobs) ? (jobs[0] || {}) : (jobs && typeof jobs === 'object' ? jobs : {});
  const input = job.Input || job.input || {};
  const operation = job.Operation || job.operation || {};
  const outputRaw = operation.Output ?? operation.output ?? job.Output ?? job.output ?? {};
  const output = Array.isArray(outputRaw)
    ? (outputRaw[0] || {})
    : (outputRaw && typeof outputRaw === 'object' ? outputRaw : {});
  const workflow = job.Workflow || job.workflow || {};
  const size = findObjectSize(output);
  const { width, height } = findWidthHeight(job.MediaInfo || job.mediaInfo || {});

  return {
    eventName: toText(root.EventName ?? root.eventName),
    tag: toText(job.Tag ?? job.tag),
    state: toText(job.State ?? job.state),
    message: toText(job.Message ?? job.message),
    inputKey: decodeObjectKey(input.Object ?? input.object),
    outputKey: decodeObjectKey(output.Object ?? output.object),
    outputSize: size,
    templateId: toText(operation.TemplateId ?? operation.templateId ?? job.TemplateId),
    templateName: toText(operation.TemplateName ?? operation.templateName ?? job.TemplateName),
    nodeName: toText(workflow.Name ?? workflow.name),
    workflowId: toText(workflow.WorkflowId ?? workflow.workflowId),
    workflowName: toText(workflow.WorkflowName ?? workflow.workflowName),
    runId: toText(workflow.RunId ?? workflow.runId),
    width,
    height
  };
}

// 回调里没有统一的字段名，产物大小到处可能在，按优先级找第一个数字。
function findObjectSize(output) {
  const candidates = [
    output.ObjectSize,
    output.objectSize,
    output.Size,
    output.size
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

// 从 MediaInfo 里挖出视频宽高，用于在缺少路径线索时反推转码档位。
function findWidthHeight(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) {
    return { width: 0, height: 0 };
  }

  const width = Number(node.Width ?? node.width ?? 0) || 0;
  const height = Number(node.Height ?? node.height ?? 0) || 0;
  if (width > 0 && height > 0) {
    return { width, height };
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findWidthHeight(value, depth + 1);
      if (found.width > 0 && found.height > 0) {
        return found;
      }
    }
  }

  return { width: 0, height: 0 };
}

// 判断这次回调属于 720p 还是 1080p：
// 优先看产物路径（我们配置的是 transcoded/720p/、transcoded/1080p/），
// 其次看转码后画面的长边（做成竖屏视频也能判断），都拿不到就放弃。
export function resolveTranscodeQuality({ outputKey = '', width = 0, height = 0 } = {}) {
  const key = toText(outputKey);
  const matched = key.match(/(?:^|[/_\-. ])(720p|1080p)(?:[/_\-. ]|$)/i);
  if (matched) {
    return matched[1].toLowerCase();
  }

  const longSide = Math.max(Number(width) || 0, Number(height) || 0);
  if (longSide >= 1600) {
    return '1080p';
  }
  if (longSide >= 1000) {
    return '720p';
  }

  return '';
}

// 用回调里的源文件 key 反查 videos.id。
// 数据库存的是完整公开地址，所以先用 getPublicUrl 拼回来做等值匹配，
// 匹配不到再用“后缀匹配”兜底（历史上域名前缀变过，避免老数据漏掉）。
export async function findVideoIdBySourceKey(key) {
  const objectKey = toText(key);
  if (!objectKey) {
    return 0;
  }

  const publicUrl = getPublicUrl(objectKey);
  const exact = await pool.query('SELECT id FROM videos WHERE video_url = $1 ORDER BY id DESC LIMIT 1', [publicUrl]);
  if (exact.rowCount > 0) {
    return exact.rows[0].id;
  }

  const suffix = await pool.query(
    'SELECT id FROM videos WHERE right(video_url, length($1)) = $1 ORDER BY id DESC LIMIT 1',
    [objectKey]
  );

  return suffix.rowCount > 0 ? suffix.rows[0].id : 0;
}

export function isCiSuccessState(state) {
  return toText(state).toLowerCase() === CI_SUCCESS_STATE;
}

// 数据万象控制台没有“回调密钥”配置项，所以密钥通过回调地址的 query 参数带过来
// （https://api.nxhguitar.com/api/videos/transcode/callback?token=xxx）。
// 同时兼容 HMAC 签名头，方便以后换成带签名的回调方式。
// 没配置 CI_CALLBACK_SECRET 时一律拒绝：否则任何人都能伪造回调写入转码地址。
export function verifyCiCallbackRequest({ rawBody = '', signature = '', token = '', secret = '' }) {
  const expectedSecret = toText(secret);
  if (!expectedSecret) {
    return { ok: false, reason: 'unconfigured' };
  }

  if (timingSafeEquals(toText(token), expectedSecret)) {
    return { ok: true, via: 'query-token' };
  }

  const providedSignature = toText(signature);
  if (providedSignature) {
    const expectedSignature = crypto.createHmac('sha256', expectedSecret).update(rawBody || '').digest('hex');
    if (timingSafeEquals(providedSignature, expectedSignature)) {
      return { ok: true, via: 'hmac' };
    }
  }

  return { ok: false, reason: 'invalid' };
}

export async function getVideoObjectKeys(videoId, extraUrls = []) {
  const renditionResult = await pool.query('SELECT video_url FROM video_renditions WHERE video_id = $1', [videoId]);
  return [
    ...extraUrls,
    ...renditionResult.rows.map((row) => row.video_url)
  ]
    .map((url) => getKeyFromPublicUrl(url))
    .filter(Boolean);
}

export async function deleteObjectKeys(keys) {
  await Promise.all([...new Set(keys)].map((key) => deleteFromBucket(key).catch(() => {})));
}

export async function deleteVideoObjects(videoId, extraUrls = []) {
  const keys = await getVideoObjectKeys(videoId, extraUrls);
  await deleteObjectKeys(keys);
}
