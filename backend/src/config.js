import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

// dotenv 会读取 backend/.env 文件，把里面的配置放到 process.env 中。
// 这里使用绝对路径读取 .env，避免因为启动命令所在目录不同而读取失败。
dotenv.config({ path: path.resolve(currentDir, '../.env') });

function inferCookieSecure() {
  const explicit = process.env.COOKIE_SECURE;

  if (explicit === 'true' || explicit === '1') {
    return true;
  }

  if (explicit === 'false' || explicit === '0') {
    return false;
  }

  // 没有显式配置时，根据前端地址协议判断：HTTPS 才启用 Secure Cookie。
  // 这样用 HTTP 临时访问服务器也不会登录后立刻掉线。
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  return frontendUrl.startsWith('https://');
}

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  databaseUrl: process.env.DATABASE_URL,
  isProduction: process.env.NODE_ENV === 'production',
  cookieSecure: inferCookieSecure(),
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    adminCookieName: process.env.ADMIN_COOKIE_NAME || 'admin_token',
    userCookieName: process.env.USER_COOKIE_NAME || 'user_token',
    tokenExpiresInSeconds: 7 * 24 * 60 * 60
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT,
    publicBaseUrl: process.env.PUBLIC_BUCKET_BASE_URL || (process.env.S3_PUBLIC_ENDPOINT && process.env.S3_BUCKET
      ? `${process.env.S3_PUBLIC_ENDPOINT.replace(/\/$/, '')}/${process.env.S3_BUCKET}`
      : '')
  },
  ci: {
    callbackSecret: process.env.CI_CALLBACK_SECRET || ''
  }
};
