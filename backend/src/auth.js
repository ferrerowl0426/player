import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

// 管理端鉴权必须回查数据库当前状态，不能只信 token 里的快照。
// 原因：JWT 有效期 7 天，老师被停用（或角色被升降）后，旧 token 里的
// role / status 仍是登录那一刻的值，只信 token 会导致停用老师 7 天内仍能管理学员。
async function loadCurrentAdmin(adminId) {
  const numericId = Number(adminId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, username, account, nickname, role, status FROM admins WHERE id = $1',
    [numericId]
  );

  return result.rows[0] || null;
}

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

function getClearCookieOptions() {
  const { maxAge, ...options } = getCookieOptions();
  return options;
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
  res.clearCookie(cookieName, getClearCookieOptions());
}

export function signAdminToken(admin) {
  return signToken({
    type: 'admin',
    adminId: admin.id,
    username: admin.username,
    role: admin.role,
    status: admin.status || 'active'
  });
}

export function signUserToken(user) {
  return signToken({
    type: 'user',
    userId: user.id,
    role: user.role || 'user',
    status: user.status || 'active'
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

function readAdminPayload(req, res) {
  const token = readToken(req, config.auth.adminCookieName);

  if (!token) {
    res.status(401).json({ message: '请先登录老师账号' });
    return null;
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);

    if (payload.type !== 'admin') {
      res.status(401).json({ message: '老师登录状态无效' });
      return null;
    }

    return payload;
  } catch (error) {
    clearAdminCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
    return null;
  }
}

// 解析 token 并回查数据库，返回“以数据库为准”的管理员会话信息。
// 返回 null 表示已经写过响应，调用方直接 return 即可。
async function resolveAdminSession(req, res, next, { allowDisabled = false } = {}) {
  const payload = readAdminPayload(req, res);
  if (!payload) {
    return null;
  }

  let current;
  try {
    current = await loadCurrentAdmin(payload.adminId);
  } catch (error) {
    next(error);
    return null;
  }

  if (!current) {
    // 账号已被删除：token 立即失效。
    clearAdminCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
    return null;
  }

  if (current.status !== 'active' && !allowDisabled) {
    res.status(403).json({ message: '此账号已停用，不能执行管理操作' });
    return null;
  }

  // 角色、状态一律以数据库为准：降权 / 停用 / 复权都能立刻生效。
  return {
    ...payload,
    adminId: current.id,
    username: current.username,
    account: current.account,
    nickname: current.nickname,
    role: current.role,
    status: current.status
  };
}

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    const admin = await resolveAdminSession(req, res, next);
    if (!admin) {
      return;
    }

    if (!allowedRoles.includes(admin.role)) {
      res.status(403).json({ message: '没有执行此操作的权限' });
      return;
    }

    req.admin = admin;
    next();
  };
}

export async function requireAdminSession(req, res, next) {
  // 停用状态也放行：老师仍可登录并看到停用提示，只是不能执行管理操作。
  const admin = await resolveAdminSession(req, res, next, { allowDisabled: true });
  if (!admin) {
    return;
  }

  if (admin.role !== 'teacher' && admin.role !== 'super_admin') {
    res.status(403).json({ message: '没有执行此操作的权限' });
    return;
  }

  req.admin = admin;
  next();
}

export function requireAdmin(req, res, next) {
  return requireRole('teacher', 'super_admin')(req, res, next);
}

export const requireTeacherOrSuperAdmin = requireAdmin;

export const requireSuperAdmin = requireRole('super_admin');

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
        return next();
      }

      if (payload.type === 'admin') {
        req.admin = payload;
        return next();
      }
    } catch (error) {
      // 如果一个 Cookie 过期了，继续尝试另一个身份的 Cookie。
    }
  }

  res.status(401).json({ message: '请先登录' });
}
