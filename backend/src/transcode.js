import crypto from 'node:crypto';
import { pool } from './db.js';
import { deleteFromBucket, getKeyFromPublicUrl } from './storage.js';

const READY_STATUS = 'ready';
const PROCESSING_STATUS = 'processing';
const FAILED_STATUS = 'failed';
const TRANSCODE_QUALITIES = ['1080p', '720p'];
const ALLOWED_STATUSES = new Set([READY_STATUS, PROCESSING_STATUS, FAILED_STATUS]);

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

export function verifyCiSignature({ rawBody, signature, secret }) {
  if (!secret) {
    return true;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  const received = String(signature || '');
  if (received.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
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
