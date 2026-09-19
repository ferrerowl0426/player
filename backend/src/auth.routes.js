import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearAdminCookie, clearUserCookie, getAdminCookieOptions, getUserCookieOptions, signAdminToken, signUserToken } from './auth.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

export const authRouter = Router();

// POST /api/auth/login
// 统一登录入口：后端根据账号所在表自动识别学员、老师或教导主任。
authRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      res.status(400).json({ message: '请填写账号和密码' });
      return;
    }

    const adminResult = await pool.query(
      `SELECT id, username, account, nickname, password_hash, role, status
       FROM admins
       WHERE account = $1 OR username = $1`,
      [username]
    );
    const admin = adminResult.rows[0];

    if (admin) {
      const passwordMatched = await bcrypt.compare(password, admin.password_hash);

      if (!passwordMatched) {
        res.status(401).json({ message: '账号或密码错误' });
        return;
      }

      clearUserCookie(res);
      const token = signAdminToken(admin);
      res.cookie(config.auth.adminCookieName, token, getAdminCookieOptions());
      res.json({ data: { id: admin.id, username: admin.username, account: admin.account, nickname: admin.nickname, role: admin.role, status: admin.status || 'active', isActive: admin.status !== 'disabled' } });
      return;
    }

    const userResult = await pool.query(
      `SELECT id, username, account, nickname, password_hash, status, is_active
       FROM users
       WHERE account = $1 OR username = $1`,
      [username]
    );
    const user = userResult.rows[0];

    if (!user) {
      res.status(401).json({ message: '账号或密码错误' });
      return;
    }

    const passwordMatched = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatched) {
      res.status(401).json({ message: '账号或密码错误' });
      return;
    }

    clearAdminCookie(res);
    const token = signUserToken(user);
    res.cookie(config.auth.userCookieName, token, getUserCookieOptions());
    res.json({ data: { id: user.id, username: user.username, account: user.account, nickname: user.nickname, role: 'user', status: user.status || (user.is_active ? 'active' : 'disabled'), isActive: Boolean(user.is_active) } });
  } catch (error) {
    next(error);
  }
});
