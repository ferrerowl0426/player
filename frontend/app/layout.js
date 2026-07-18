import './globals.css';

export const metadata = {
  title: '学习播放器',
  description: 'Next.js 前端 + Express 后端的视频播放器学习项目'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <a className="logo" href="/">学习播放器</a>
          <nav className="site-nav">
            <a href="/">普通用户</a>
            <a href="/admin">管理员</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
