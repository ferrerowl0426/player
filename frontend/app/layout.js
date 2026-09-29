import './design-system.css';
import './globals.css';

export const metadata = {
  title: '能学慧吉他课堂笔记整理工具',
  description: '能学慧吉他课堂笔记整理工具，仅供吉他爱好者整理学习笔记与课程资料'
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
