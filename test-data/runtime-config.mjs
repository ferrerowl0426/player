import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { config as backendConfig } from '../backend/src/config.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDir, '..');

// backend/src/config.js 只固定读取 backend/.env。服务器 Docker Compose 实际使用根目录 .env，
// 因此 test-data 脚本额外读取根目录 .env，并允许命令行环境变量覆盖文件配置。
dotenv.config({ path: path.join(projectRoot, '.env'), override: false });
dotenv.config({ path: path.join(projectRoot, 'backend/.env'), override: false });

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeDatabaseUrl(url) {
  if (!url) return '';
  return String(url).replace(/^postgres:\/\//, 'postgresql://');
}

function buildDatabaseUrlFromParts() {
  const host = firstNonEmpty(process.env.DB_HOST, process.env.PGHOST);
  const port = firstNonEmpty(process.env.DB_PORT, process.env.PGPORT, '5432');
  const user = firstNonEmpty(process.env.DB_USER, process.env.PGUSER);
  const password = firstNonEmpty(process.env.DB_PASSWORD, process.env.PGPASSWORD);
  const database = firstNonEmpty(process.env.DB_NAME, process.env.PGDATABASE);

  if (!host || !user || !password || !database) return '';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function requireConfig(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`缺少 ${name} 配置。请设置 DATABASE_URL，或设置 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME。服务器宿主机执行时注意 PostgreSQL 映射端口通常是 15432。`);
  }
  return value;
}

export function getRuntimeConfig() {
  const databaseUrl = requireConfig(
    normalizeDatabaseUrl(firstNonEmpty(
      process.env.DATABASE_URL,
      buildDatabaseUrlFromParts(),
      backendConfig.databaseUrl
    )),
    'DATABASE_URL'
  );

  return {
    ...backendConfig,
    databaseUrl,
    s3: {
      ...backendConfig.s3,
      endpoint: firstNonEmpty(process.env.S3_ENDPOINT, backendConfig.s3.endpoint),
      region: firstNonEmpty(process.env.S3_REGION, backendConfig.s3.region, 'us-east-1'),
      bucket: firstNonEmpty(process.env.S3_BUCKET, backendConfig.s3.bucket),
      accessKeyId: firstNonEmpty(process.env.S3_ACCESS_KEY_ID, backendConfig.s3.accessKeyId),
      secretAccessKey: firstNonEmpty(process.env.S3_SECRET_ACCESS_KEY, backendConfig.s3.secretAccessKey),
      forcePathStyle: firstNonEmpty(process.env.S3_FORCE_PATH_STYLE, String(backendConfig.s3.forcePathStyle)) === 'true',
      publicEndpoint: firstNonEmpty(process.env.S3_PUBLIC_ENDPOINT, backendConfig.s3.publicEndpoint),
      publicBaseUrl: firstNonEmpty(process.env.PUBLIC_BUCKET_BASE_URL, backendConfig.s3.publicBaseUrl)
    }
  };
}
