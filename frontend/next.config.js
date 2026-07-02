import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd()),

  // 这里允许页面中的 <img> 显示任意存储桶域名图片。
  // 因为本项目可能使用本地 MinIO，也可能以后切换腾讯云 COS。
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**'
      },
      {
        protocol: 'https',
        hostname: '**'
      }
    ]
  }
};

export default nextConfig;
