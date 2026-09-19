import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { ensureAppSchema } from './db.js';
import { authRouter } from './auth.routes.js';
import { adminRouter } from './admin.routes.js';
import { userAuthRouter } from './user-auth.routes.js';
import { tracksRouter } from './tracks.routes.js';
import { knowledgeRouter } from './knowledge.routes.js';
import { prerequisiteRouter } from './prerequisites.routes.js';
import { libraryRouter } from './library.routes.js';
import { videoRouter } from './videos.routes.js';

const app = express();

function getAllowedOrigins() {
  const origins = new Set([config.frontendUrl]);

  try {
    const frontendUrl = new URL(config.frontendUrl);
    if (frontendUrl.hostname === 'localhost') {
      origins.add(`${frontendUrl.protocol}//127.0.0.1:${frontendUrl.port}`);
    }
    if (frontendUrl.hostname === '127.0.0.1') {
      origins.add(`${frontendUrl.protocol}//localhost:${frontendUrl.port}`);
    }
  } catch {
    // 保留原始配置即可。
  }

  return origins;
}

const allowedOrigins = getAllowedOrigins();

// cors 允许前端项目跨域访问后端 API。
// 前端运行在 3001 端口，后端运行在 3000 端口，浏览器会认为它们是不同来源。
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`不允许的跨域来源：${origin}`));
    },
    credentials: true
  })
);

// 解析 HttpOnly Cookie，管理员 JWT 鉴权会从 Cookie 中读取 token。
app.use(cookieParser());

// 解析 JSON 请求体。
// 目前上传接口用的是 multipart/form-data，
// 但以后做评论、收藏等接口时经常会用 JSON。
app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  }
}));

// 健康检查接口，用来确认后端是否启动成功。
app.get('/api/health', (req, res) => {
  res.json({ message: '后端服务运行正常' });
});

// 统一登录接口，会自动识别学员、老师或教导主任账号。
app.use('/api/auth', authRouter);

// 管理员登录、退出和登录状态检查接口。
app.use('/api/admin', adminRouter);

// 普通用户登录、退出和登录状态检查接口。
app.use('/api/user', userAuthRouter);

// 曲目库相关接口，游客也可以访问。
app.use('/api/tracks', tracksRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/prerequisites', prerequisiteRouter);
app.use('/api/library', libraryRouter);

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

ensureAppSchema()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`后端服务已启动：http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error('初始化数据库失败', error);
    process.exit(1);
  });
