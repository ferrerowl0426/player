import './globals.css';
import SiteHeader from '../components/SiteHeader.js';

export const metadata = {
  title: '学习播放器',
  description: 'Next.js 前端 + Express 后端的视频播放器学习项目'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
