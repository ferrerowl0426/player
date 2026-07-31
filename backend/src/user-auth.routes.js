import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearUserCookie, getUserCookieOptions, requireUser, signUserToken } from './auth.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

export const userAuthRouter = Router();

// POST /api/user/login
// 普通用户登录成功后，后端把 JWT 写入 HttpOnly Cookie。
// 这样前端不需要保存 token，浏览器后续请求会自动携带登录状态。
userAuthRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      res.status(400).json({ message: '请填写用户账号和密码' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, is_active
       FROM users
       WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];
    const passwordMatched = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!passwordMatched) {
      res.status(401).json({ message: '用户账号或密码错误' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ message: '这个用户已被禁用，请联系管理员' });
      return;
    }

    const token = signUserToken(user);
    res.cookie(config.auth.userCookieName, token, getUserCookieOptions());
    res.json({ data: { username: user.username } });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/me
// 普通首页加载时用它确认是否已经登录。
userAuthRouter.get('/me', requireUser, (req, res) => {
  res.json({
    data: {
      username: req.user.username
    }
  });
});

// POST /api/user/logout
// 清除普通用户 Cookie。
userAuthRouter.post('/logout', (req, res) => {
  clearUserCookie(res);
  res.json({ message: '已退出登录' });
});

// GET /api/user/assignments/today
// 用户首页的“今日的作业”分成两块：有效视频推送和最新留言。
userAuthRouter.get('/assignments/today', requireUser, async (req, res, next) => {
  try {
    const videosResult = await pool.query(
      `SELECT
         ua.id,
         '' AS message,
         ua.created_at,
         v.id AS video_id,
         v.title AS video_title,
         v.description AS video_description,
         v.cover_url AS video_cover_url,
         v.created_at AS video_created_at
       FROM user_assignments ua
       JOIN videos v ON v.id = ua.video_id
       WHERE ua.user_id = $1
         AND ua.video_id IS NOT NULL
         AND ua.is_deleted = FALSE
       ORDER BY ua.created_at DESC`,
      [req.user.userId]
    );

    const messageResult = await pool.query(
      `SELECT
         id,
         message,
         created_at,
         NULL AS video_id,
         NULL AS video_title,
         NULL AS video_description,
         NULL AS video_cover_url,
         NULL AS video_created_at
       FROM user_assignments
       WHERE user_id = $1
         AND video_id IS NULL
         AND is_deleted = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.userId]
    );

    const assignments = [...videosResult.rows, ...messageResult.rows];
    const assignmentDate = assignments[0]?.created_at || null;

    res.json({
      data: {
        assignmentDate,
        assignments
      }
    });
  } catch (error) {
    next(error);
  }
});

