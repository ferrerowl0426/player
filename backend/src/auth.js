import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';
import { createContentViewerResolver, createContentViewerMiddleware } from './content-viewer.js';

const resolveContentViewer = createContentViewerResolver({
  verifyToken: (token) => jwt.verify(token, config.auth.jwtSecret),
  loadAdmin: loadCurrentAdmin,
  loadUser: async (userId) => {
    const result = await pool.query('SELECT id, status, auth_version FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }
});

// Applied to content reads in the next integration step; never accepts roles from the client.
export const optionalContentViewer = createContentViewerMiddleware(resolveContentViewer, {
  adminCookieName: config.auth.adminCookieName,
  userCookieName: config.auth.userCookieName
});

// 管理端鉴权必须回查数据库当前状态，不能只信 token 里的快照。
// 原因：JWT 有效期 7 天，老师被停用（或角色被升降、改密）后，旧 token 里的
// role / status / auth_version 仍是登录那一刻的值，只信 token 会导致停用老师
// 7 天内仍能管理学员，或改密后旧 token 仍可用。
async function loadCurrentAdmin(adminId) {
  const numericId = Number(adminId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, username, account, nickname, role, status, auth_version FROM admins WHERE id = $1',
    [numericId]
  );

  return result.rows[0] || null;
}

// 当前会话的 auth_version 必须与数据库一致，否则该 token 视为失效。
// - 数据库缺列（auth_version 为 undefined）：仅在未迁移/测试中出现；
//   生产库经启动门禁保证该列恒存在，此处放行不会削弱安全性。
// - token 缺 authVersion（迁移前签发的旧 token）：一律拒绝，强制重新登录。
function authVersionMatches(payload, current) {
  if (!current) return false;
  if (current.auth_version === undefined || current.auth_version === null) return true;
  if (payload.authVersion === undefined) return false;
  return Number(payload.authVersion) === Number(current.auth_version);
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

function signToken(payload, expiresIn = config.auth.tokenExpiresInSeconds) {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn });
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
    status: admin.status || 'active',
    authVersion: admin.auth_version ?? 0
  });
}

export function signUserToken(user, options = {}) {
  return signToken({
    type: 'user',
    userId: user.id,
    role: user.role || 'user',
    status: user.status || 'active',
    authVersion: user.auth_version ?? 0
  }, options.expiresIn);
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
export async function resolveAdminSession(req, res, next, { allowDisabled = false } = {}) {
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

  // 改密 / 管理重置会递增 auth_version，使旧 token 立即失效。
  // 缺版本（迁移前旧 token）或版本不匹配一律拒绝。
  if (!authVersionMatches(payload, current)) {
    clearAdminCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
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
    status: current.status,
    authVersion: current.auth_version
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

async function loadCurrentUser(userId) {
  const numericId = Number(userId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, status, is_active, auth_version FROM users WHERE id = $1',
    [numericId]
  );

  return result.rows[0] || null;
}

export async function requireUser(req, res, next) {
  const token = readToken(req, config.auth.userCookieName);

  if (!token) {
    res.status(401).json({ message: '请先登录学员账号' });
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret);

    if (payload.type !== 'user') {
      res.status(401).json({ message: '学员登录状态无效' });
      return;
    }
  } catch (error) {
    clearUserCookie(res);
    res.status(401).json({ message: '登录已过期，请重新登录' });
    return;
  }

  // 回查数据库：学员被停用 / 改密后，旧 token 必须立即失效。
  try {
    const current = await loadCurrentUser(payload.userId);

    if (!current) {
      clearUserCookie(res);
      res.status(401).json({ message: '登录已过期，请重新登录' });
      return;
    }

    const active = current.status === 'active' && current.is_active !== false;
    if (!active) {
      clearUserCookie(res);
      res.status(403).json({ message: '此账号已停用，无法继续访问' });
      return;
    }

    if (!authVersionMatches(payload, current)) {
      clearUserCookie(res);
      res.status(401).json({ message: '登录已过期，请重新登录' });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireUserOrAdmin(req, res, next) {
  const userToken = readToken(req, config.auth.userCookieName);
  const adminToken = readToken(req, config.auth.adminCookieName);

  // 视频列表和详情页学员、老师都会访问，所以这里允许两种 Cookie。
  // 具体上传、删除等后台操作仍然只使用 requireAdmin。
  // 两种身份都回查数据库当前状态与 auth_version，缺版本 / 不匹配的旧 token 一律拒绝。
  const tryAdmin = async () => {
    const payload = jwt.verify(adminToken, config.auth.jwtSecret);
    if (payload.type !== 'admin') return false;
    const current = await loadCurrentAdmin(payload.adminId);
    if (!current || current.status !== 'active') return false;
    if (!authVersionMatches(payload, current)) return false;
    req.admin = { ...payload, adminId: current.id, role: current.role, status: current.status, authVersion: current.auth_version };
    return true;
  };

  const tryUser = async () => {
    const payload = jwt.verify(userToken, config.auth.jwtSecret);
    if (payload.type !== 'user') return false;
    const current = await loadCurrentUser(payload.userId);
    if (!current) return false;
    const active = current.status === 'active' && current.is_active !== false;
    if (!active) return false;
    if (!authVersionMatches(payload, current)) return false;
    req.user = payload;
    return true;
  };

  const attempt = async () => {
    // 优先以学员身份放行（与原逻辑一致），其次老师。
    if (userToken) {
      try {
        if (await tryUser()) return next();
      } catch {
        // 该身份无效，尝试另一种。
      }
    }
    if (adminToken) {
      try {
        if (await tryAdmin()) return next();
      } catch {
        // 该身份无效。
      }
    }
    res.status(401).json({ message: '请先登录' });
  };

  attempt().catch((error) => next(error));
}
