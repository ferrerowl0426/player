import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

// dotenv 会读取 backend/.env 文件，把里面的配置放到 process.env 中。
// 这里使用绝对路径读取 .env，避免因为启动命令所在目录不同而读取失败。
dotenv.config({ path: path.resolve(currentDir, '../.env') });

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  databaseUrl: process.env.DATABASE_URL,
  isProduction: process.env.NODE_ENV === 'production',
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    cookieName: process.env.ADMIN_COOKIE_NAME || 'admin_token',
    tokenExpiresIn: '7d'
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT,
    publicBaseUrl: process.env.PUBLIC_BUCKET_BASE_URL
  }
};
