import { config } from './config.js';
import { getKeyFromPublicUrl } from './storage.js';

const ALLOWED_SCENES = new Set(['library', 'track', 'knowledge', 'attachment', 'video']);
const DEFAULT_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 1800;
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const rateBuckets = new Map();

function clampTtl(ttlSeconds) {
  const ttl = Number(ttlSeconds || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl)) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(ttl)));
}

function checkRateLimit(studentId, ip) {
  const key = `${studentId}:${ip || 'unknown'}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.startedAt > WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

function scenePrefixes(scene) {
  switch (scene) {
    case 'track':
    case 'video':
      return ['tracks/', 'transcoded/'];
    case 'knowledge':
      return ['knowledge/'];
    case 'attachment':
      return ['attachments/'];
    case 'library':
    default:
      return ['library/'];
  }
}

function keyPrefixFromUrl(url) {
  const key = getKeyFromPublicUrl(url || '');
  if (!key) {
    return '';
  }
  const index = key.lastIndexOf('/');
  return index >= 0 ? key.slice(0, index + 1) : key;
}

export function buildMiniStsPolicy({ scene, files = [] }) {
  const prefixes = new Set(scenePrefixes(scene));

  for (const file of files) {
    const prefix = keyPrefixFromUrl(file.file_url || file.url || '');
    if (prefix) {
      prefixes.add(prefix);
    }
  }

  const allowPrefixes = [...prefixes];
  const region = config.s3.region;
  const bucket = config.s3.bucket;

  return {
    allowPrefixes,
    policy: {
      version: '2.0',
      statement: [
        {
          effect: 'allow',
          action: ['name/cos:GetObject', 'name/cos:HeadObject'],
          resource: allowPrefixes.map((prefix) => `qcs::cos:${region}:uid/*:${bucket}/${prefix}*`)
        }
      ]
    }
  };
}

export async function issueMiniSts({ student, ip, scene, fileIds = [], ttlSeconds }) {
  if (!ALLOWED_SCENES.has(scene)) {
    const error = new Error('不支持的文件访问场景');
    error.status = 400;
    error.code = 'INVALID_SCENE';
    throw error;
  }

  if (!checkRateLimit(student.id, ip)) {
    const error = new Error('签发过于频繁，请稍后再试');
    error.status = 429;
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const ttl = clampTtl(ttlSeconds);
  const now = Math.floor(Date.now() / 1000);
  const { allowPrefixes, policy } = buildMiniStsPolicy({ scene, files: [] });

  return {
    credentials: null,
    startTime: now,
    expiredTime: now + ttl,
    bucket: config.s3.bucket || '',
    region: config.s3.region || '',
    allowPrefixes,
    policy,
    fileIds: fileIds.map(String),
    fallbackRequired: true,
    message: 'STS SDK 尚未配置，当前仅返回最小权限 policy 元数据；请接入腾讯云 STS 后替换 credentials。'
  };
}
