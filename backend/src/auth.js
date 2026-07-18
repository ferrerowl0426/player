import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signAdminToken(admin) {
  return jwt.sign(
    {
      adminId: admin.id,
      username: admin.username
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenExpiresIn }
  );
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.[config.auth.cookieName];

  if (!token) {
    res.status(401).json({ message: '请先登录管理员账号' });
    return;
  }

  try {
    req.admin = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch (error) {
    res.clearCookie(config.auth.cookieName, getAdminCookieOptions());
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}
