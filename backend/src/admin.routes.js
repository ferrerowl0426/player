import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { getAdminCookieOptions, requireAdmin, signAdminToken } from './auth.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

export const adminRouter = Router();

// POST /api/admin/login
// 管理员登录成功后，后端把 JWT 写入 HttpOnly Cookie。
// 前端 JavaScript 不能读取这个 Cookie，但浏览器请求后端时会自动携带它。
adminRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      res.status(400).json({ message: '请填写管理员账号和密码' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash
       FROM admins
       WHERE username = $1`,
      [username]
    );

    const admin = result.rows[0];
    const passwordMatched = admin ? await bcrypt.compare(password, admin.password_hash) : false;

    if (!passwordMatched) {
      res.status(401).json({ message: '管理员账号或密码错误' });
      return;
    }

    const token = signAdminToken(admin);
    res.cookie(config.auth.cookieName, token, getAdminCookieOptions());
    res.json({ data: { username: admin.username } });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/me
// 管理员页面加载时用它确认是否已经登录。
adminRouter.get('/me', requireAdmin, (req, res) => {
  res.json({
    data: {
      username: req.admin.username
    }
  });
});

// POST /api/admin/logout
// 清除管理员 Cookie。
adminRouter.post('/logout', (req, res) => {
  res.clearCookie(config.auth.cookieName, getAdminCookieOptions());
  res.json({ message: '已退出登录' });
});
