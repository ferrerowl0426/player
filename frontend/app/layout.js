import './design-system.css';
import './globals.css';

export const metadata = {
  title: '学习播放器',
  description: 'Next.js 前端 + Express 后端的视频播放器学习项目'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
      </body>
    </html>
  );
}
