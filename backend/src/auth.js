import jwt from 'jsonwebtoken';
import { config } from './config.js';

function getTokenMaxAgeMs() {
  return config.auth.tokenExpiresInSeconds * 1000;
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: getTokenMaxAgeMs()
  };
}

function signToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.tokenExpiresInSeconds
  });
}

// 老师和学员使用不同 Cookie 名称，并且 token 里写入 type。
// 这样即使浏览器同时登录两种身份，后端也能明确知道当前接口需要哪一种身份。
function readToken(req, cookieName) {
  return req.cookies?.[cookieName];
}

function clearAuthCookie(res, cookieName) {
  res.clearCookie(cookieName, getCookieOptions());
}

export function signAdminToken(admin) {
  return signToken({
    type: 'admin',
    adminId: admin.id,
    username: admin.username,
    role: admin.role
  });
}

export function signUserToken(user) {
  return signToken({
    type: 'user',
    userId: user.id,
    username: user.username
  });
}

export function getAdminCookieOptions() {
  return getCookieOptions();
}

export function getUserCookieOptions() {
  return getCookieOptions();
}

export function clearAdminCookie(res) {
  clearAuthCookie(res, config.auth.adminCookieName);
}

export function clearUserCookie(res) {
  clearAuthCookie(res, config.auth.userCookieName);
}

export function requireAdmin(req, res, next) {
  const token = readToken(req, config.auth.adminCookieName);

  if (!token) {
    res.status(401).json({ message: '请先登录老师账号' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);

    if (payload.type !== 'admin') {
      res.status(401).json({ message: '老师登录状态无效' });
      return;
    }

    req.admin = payload;
    next();
  } catch (error) {
    clearAdminCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

export function requireSuperAdmin(req, res, next) {
  const token = readToken(req, config.auth.adminCookieName);

  if (!token) {
    res.status(401).json({ message: '请先登录老师账号' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);

    if (payload.type !== 'admin') {
      res.status(401).json({ message: '老师登录状态无效' });
      return;
    }

    if (payload.role !== 'super_admin') {
      res.status(403).json({ message: '需要教导主任权限' });
      return;
    }

    req.admin = payload;
    next();
  } catch (error) {
    clearAdminCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

export function requireUser(req, res, next) {
  const token = readToken(req, config.auth.userCookieName);

  if (!token) {
    res.status(401).json({ message: '请先登录学员账号' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);

    if (payload.type !== 'user') {
      res.status(401).json({ message: '学员登录状态无效' });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    clearUserCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

export function requireUserOrAdmin(req, res, next) {
  const userToken = readToken(req, config.auth.userCookieName);
  const adminToken = readToken(req, config.auth.adminCookieName);

  // 视频列表和详情页学员、老师都会访问，所以这里允许两种 Cookie。
  // 具体上传、删除等后台操作仍然只使用 requireAdmin。
  for (const token of [userToken, adminToken]) {
    if (!token) {
      continue;
    }

    try {
      const payload = jwt.verify(token, config.auth.jwtSecret);

      if (payload.type === 'user') {
        req.user = payload;
        next();
        return;
      }

      if (payload.type === 'admin') {
        req.admin = payload;
        next();
        return;
      }
    } catch (error) {
      // 如果一个 Cookie 过期了，继续尝试另一个身份的 Cookie。
    }
  }

  res.status(401).json({ message: '请先登录' });
}
