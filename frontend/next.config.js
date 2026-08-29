import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd()),

  // 本地开发和测试阶段避免浏览器/Next.js 缓存旧页面或 JS chunk，
  // 保证代码更新后能立即生效。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
          }
        ]
      }
    ];
  },

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
