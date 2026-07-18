import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { ensureAdminSchema } from './db.js';
import { adminRouter } from './admin.routes.js';
import { videoRouter } from './videos.routes.js';

const app = express();

// cors 允许前端项目跨域访问后端 API。
// 前端运行在 5173 端口，后端运行在 3000 端口，浏览器会认为它们是不同来源。
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true
  })
);

// 解析 HttpOnly Cookie，管理员 JWT 鉴权会从 Cookie 中读取 token。
app.use(cookieParser());

// 解析 JSON 请求体。
// 目前上传接口用的是 multipart/form-data，
// 但以后做评论、收藏等接口时经常会用 JSON。
app.use(express.json());

// 健康检查接口，用来确认后端是否启动成功。
app.get('/api/health', (req, res) => {
  res.json({ message: '后端服务运行正常' });
});

// 管理员登录、退出和登录状态检查接口。
app.use('/api/admin', adminRouter);

// 视频相关接口统一挂载到 /api/videos。
app.use('/api/videos', videoRouter);

// 统一错误处理中间件。
// Express 中只要 next(error)，最后都会进入这里。
app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    message: error.message || '服务器内部错误'
  });
});

ensureAdminSchema()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`后端服务已启动：http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error('初始化数据库失败', error);
    process.exit(1);
  });
