import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearAdminCookie, getAdminCookieOptions, requireAdmin, requireAdminSession, requireSuperAdmin, signAdminToken } from './auth.js';

const USERNAME_PATTERN = /^\d+$/;
const USERNAME_MAX_LENGTH = 50;
const NICKNAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_]{1,10}$/;
const NICKNAME_MAX_LENGTH = 10;
const PASSWORD_MIN_LENGTH = 5;
const PASSWORD_MAX_LENGTH = 30;
const CLASS_NAME_MAX_LENGTH = 100;
const REQUIREMENT_MAX_LENGTH = 1000;
const DELETE_REASON_MAX_LENGTH = 200;
const MAX_ACTIVE_VIDEO_ASSIGNMENTS = 5;
const ASSIGNMENT_OBJECT_TYPES = new Set(['video', 'track_point', 'track_collection', 'knowledge_point', 'knowledge_collection', 'track_part', 'knowledge_part']);
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

function isInvalidTextValue(value) {
  return INVALID_TEXT_VALUES.includes(value.toLowerCase());
}

function validateUsername(username) {
  if (!username) {
    return '请填写账号';
  }

  if (isInvalidTextValue(username)) {
    return '账号不能是 null、undefined、NaN 这类无意义内容';
  }

  if (username.length > USERNAME_MAX_LENGTH) {
    return `账号最多 ${USERNAME_MAX_LENGTH} 位`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return '账号只能包含数字';
  }

  return '';
}

function validateNickname(nickname) {
  if (!nickname) {
    return '请填写昵称';
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return `昵称需为 1-${NICKNAME_MAX_LENGTH} 位中文、字母、数字或下划线`;
  }

  return '';
}

function validatePassword(password) {
  if (!password) {
    return '请填写密码';
  }

  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `密码长度必须是 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 个字符`;
  }

  return '';
}

function validateClassName(name) {
  const value = normalizeLoginText(name);

  if (!value) {
    return '请填写班级名称';
  }

  if (isInvalidTextValue(value)) {
    return '班级名称不能是 null、undefined、NaN 这类无意义内容';
  }

  if (value.length > CLASS_NAME_MAX_LENGTH) {
    return `班级名称最多 ${CLASS_NAME_MAX_LENGTH} 个字`;
  }

  return '';
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function sendValidationError(res, message) {
  res.status(400).json({ message });
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function validateRequirement(value, label) {
  if (value && isInvalidTextValue(value)) {
    return `${label}不能是 null、undefined、NaN 这类无意义内容`;
  }

  if (value.length > REQUIREMENT_MAX_LENGTH) {
    return `${label}最多 ${REQUIREMENT_MAX_LENGTH} 个字`;
  }

  return '';
}

function validateDeleteReason(reason) {
  if (!reason) {
    return '请填写删除原因';
  }

  if (isInvalidTextValue(reason)) {
    return '删除原因不能是 null、undefined、NaN 这类无意义内容';
  }

  if (reason.length > DELETE_REASON_MAX_LENGTH) {
    return `删除原因最多 ${DELETE_REASON_MAX_LENGTH} 个字`;
  }

  return '';
}

function isSuperAdmin(req) {
  return req.admin?.role === 'super_admin';
}

function isRootAdmin(req) {
  return req.admin?.role === 'super_admin' && req.admin?.username === 'admin';
}

function requireRootAdmin(req, res) {
  if (isRootAdmin(req)) return false;
  res.status(403).json({ message: '只有超级管理员可以操作教导主任账号' });
  return true;
}

async function findAdminClassIds(adminId) {
  const result = await pool.query(
    `SELECT class_id FROM teacher_classes WHERE teacher_id = $1
     UNION
     SELECT id FROM teaching_classes WHERE teacher_id = $1`,
    [adminId]
  );
  return result.rows.map((row) => row.class_id || row.id);
}

async function ensureAdminCanManageUser(req, userId) {
  if (isSuperAdmin(req)) {
    return true;
  }

  const classIds = await findAdminClassIds(req.admin.adminId);

  if (classIds.length === 0) {
    return false;
  }

  const result = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND class_id = ANY($2::int[])`,
    [userId, classIds]
  );
  return result.rowCount > 0;
}

async function findUserById(userId) {
  const result = await pool.query(
    `SELECT id, username, nickname, class_id, is_active, is_marked, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function ensureVideosExist(videoIds) {
  if (videoIds.length === 0) {
    return true;
  }

  const result = await pool.query(
    'SELECT id FROM videos WHERE id = ANY($1::int[])',
    [videoIds]
  );

  return result.rowCount === videoIds.length;
}

async function usernameExistsInAdmins(username) {
  const result = await pool.query(
    `SELECT id FROM admins WHERE username = $1 OR account = $1`,
    [username]
  );

  return result.rowCount > 0;
}

async function nicknameExistsInAdmins(nickname, excludeId = 0) {
  const result = await pool.query(
    `SELECT id FROM admins WHERE nickname = $1 AND ($2::int = 0 OR id <> $2)`,
    [nickname, excludeId]
  );

  return result.rowCount > 0;
}

async function nicknameExistsInUsers(nickname, excludeId = 0) {
  const result = await pool.query(
    `SELECT id FROM users WHERE nickname = $1 AND ($2::int = 0 OR id <> $2)`,
    [nickname, excludeId]
  );

  return result.rowCount > 0;
}

async function nicknameExistsGlobally(nickname, exclude = {}) {
  const adminExcludeId = exclude.type === 'admin' ? exclude.id || 0 : 0;
  const userExcludeId = exclude.type === 'user' ? exclude.id || 0 : 0;
  const [adminExists, userExists] = await Promise.all([
    nicknameExistsInAdmins(nickname, adminExcludeId),
    nicknameExistsInUsers(nickname, userExcludeId)
  ]);

  return adminExists || userExists;
}

async function usernameExistsInUsers(username) {
  const result = await pool.query(
    `SELECT id FROM users WHERE username = $1 OR account = $1`,
    [username]
  );

  return result.rowCount > 0;
}

export const adminRouter = Router();

// POST /api/admin/login
adminRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');
    const expectedRole = req.body.expectedRole;

    if (!username || !password) {
      res.status(400).json({ message: '请填写老师账号和密码' });
      return;
    }

    if (!expectedRole || (expectedRole !== 'teacher' && expectedRole !== 'super_admin')) {
      res.status(400).json({ message: '请选择有效的登录身份' });
      return;
    }

    // 老师/教导主任登录时，如果输入的是学员账号，明确提示角色不匹配。
    const userResult = await pool.query(
      `SELECT id FROM users WHERE account = $1 OR username = $1`,
      [username]
    );

    if (userResult.rows.length > 0) {
      res.status(403).json({ message: '没有这个老师' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, account, nickname, password_hash, role, status
       FROM admins
       WHERE account = $1 OR username = $1`,
      [username]
    );

    const admin = result.rows[0];
    const passwordMatched = admin ? await bcrypt.compare(password, admin.password_hash) : false;

    if (!passwordMatched) {
      res.status(401).json({ message: '老师账号或密码错误' });
      return;
    }

    // 选择的登录身份和账号实际角色必须一致。
    if (expectedRole && admin.role !== expectedRole) {
      const message = expectedRole === 'super_admin' ? '该账号不是教导主任' : '没有这个老师';
      res.status(403).json({ message });
      return;
    }

    const token = signAdminToken(admin);
    res.cookie(config.auth.adminCookieName, token, getAdminCookieOptions());
    res.json({ data: { id: admin.id, username: admin.username, account: admin.account, nickname: admin.nickname, role: admin.role, status: admin.status || 'active', isActive: admin.status !== 'disabled' } });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/me
adminRouter.get('/me', requireAdminSession, (req, res) => {
  res.json({
    data: {
      id: req.admin.adminId,
      username: req.admin.username,
      role: req.admin.role,
      status: req.admin.status || 'active'
    }
  });
});

// POST /api/admin/logout
adminRouter.post('/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ message: '已退出登录' });
});

// GET /api/admin/users
adminRouter.get('/users', requireAdmin, async (req, res, next) => {
  try {
    let query = `SELECT id, username, nickname, class_id, is_active, is_marked, created_at FROM users`;
    const params = [];

    if (!isSuperAdmin(req)) {
      const classIds = await findAdminClassIds(req.admin.adminId);

      if (classIds.length === 0) {
        res.json({ data: [] });
        return;
      }

      query += ` WHERE class_id = ANY($1::int[])`;
      params.push(classIds);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users
adminRouter.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);

    if (usernameError || passwordError) {
      sendValidationError(res, usernameError || passwordError);
      return;
    }

    if (await usernameExistsInAdmins(username) || await usernameExistsInUsers(username)) {
      res.status(409).json({ message: '该账号已存在，请更换账号' });
      return;
    }

    let classId = normalizeId(req.body.classId);

    if (isSuperAdmin(req)) {
      if (!classId) {
        sendValidationError(res, '请选择班级');
        return;
      }

      const classResult = await pool.query(
        `SELECT id FROM teaching_classes WHERE id = $1 AND is_active = TRUE`,
        [classId]
      );

      if (classResult.rowCount === 0) {
        sendValidationError(res, '班级不存在或已停用');
        return;
      }
    } else {
      const classIds = await findAdminClassIds(req.admin.adminId);

      const activeClassResult = await pool.query(
        `SELECT id FROM teaching_classes WHERE id = ANY($1::int[]) AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
        [classIds]
      );

      if (activeClassResult.rowCount === 0) {
        res.status(403).json({ message: '您还没有可用的班级，无法创建学员' });
        return;
      }

      classId = activeClassResult.rows[0].id;
    }

    const nickname = normalizeLoginText(req.body.nickname);
    const nicknameError = validateNickname(nickname);

    if (nicknameError) {
      sendValidationError(res, nicknameError);
      return;
    }

    if (await nicknameExistsGlobally(nickname)) {
      res.status(409).json({ message: '该昵称已存在，请更换昵称' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, account, nickname, password_hash, class_id, status, is_active)
       VALUES ($1, $1, $2, $3, $4, 'active', TRUE)
       RETURNING id, username, account, nickname, class_id, status, is_active, created_at`,
      [username, nickname, passwordHash, classId]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '该账号已存在，请更换账号' });
      return;
    }

    next(error);
  }
});

// PATCH /api/admin/users/:id
adminRouter.patch('/users/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const nickname = normalizeLoginText(req.body.nickname);
    const nicknameError = validateNickname(nickname);

    if (!userId) return sendValidationError(res, '学员 id 无效');
    if (nicknameError) return sendValidationError(res, nicknameError);
    if (await nicknameExistsGlobally(nickname, { type: 'user', id: userId })) return res.status(409).json({ message: '该昵称已存在，请更换昵称' });

    const result = await pool.query(
      `UPDATE users
       SET nickname = $1
       WHERE id = $2
       RETURNING id, username, account, nickname, class_id, status, is_active, created_at`,
      [nickname, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:id/reset-password
adminRouter.post('/users/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const password = String(req.body.password ?? '');
    const passwordError = validatePassword(password);

    if (passwordError) {
      sendValidationError(res, passwordError);
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学员' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, username, class_id, is_active, created_at`,
      [passwordHash, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/status
adminRouter.patch('/users/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const isActive = req.body.isActive === true || req.body.isActive === 'true';

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学员' });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET is_active = $1,
           status = CASE WHEN $1 THEN 'active' ELSE 'disabled' END,
           is_marked = CASE WHEN $1 THEN is_marked ELSE FALSE END
       WHERE id = $2
       RETURNING id, username, class_id, is_active, is_marked, created_at`,
      [isActive, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/mark
// 仅教导主任可标记 active 学员。
adminRouter.patch('/users/:id/mark', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const isMarked = req.body.isMarked === true || req.body.isMarked === 'true';
    const result = await pool.query(
      `UPDATE users
       SET is_marked = $1
       WHERE id = $2 AND is_active = TRUE
       RETURNING id, is_marked`,
      [isMarked, userId]
    );

    if (result.rowCount === 0) {
      const userResult = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [userId]);
      if (userResult.rowCount === 0) {
        res.status(404).json({ message: '学员不存在' });
      } else {
        res.status(400).json({ message: '停用学员不可标记' });
      }
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/marks/clear
// 清除所有 active 学员标记，不受当前筛选范围影响。
adminRouter.post('/users/marks/clear', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_marked = FALSE WHERE is_active = TRUE AND is_marked = TRUE`
    );
    res.json({ data: { clearedCount: result.rowCount } });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/class
// 教导主任给学员转班；老师不能转班。classId 为 null 表示未分班。
adminRouter.patch('/users/:id/class', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const classId = req.body.classId === null || req.body.classId === '' || req.body.classId === undefined
      ? null
      : normalizeId(req.body.classId);

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    if (req.body.classId !== null && req.body.classId !== '' && req.body.classId !== undefined && !classId) {
      sendValidationError(res, '目标班级无效');
      return;
    }

    if (classId) {
      const classResult = await pool.query(
        `SELECT id FROM teaching_classes WHERE id = $1 AND is_active = TRUE`,
        [classId]
      );

      if (classResult.rowCount === 0) {
        res.status(404).json({ message: '班级不存在或已停用' });
        return;
      }
    }

    const result = await pool.query(
      `UPDATE users
       SET class_id = $1
       WHERE id = $2
       RETURNING id, username, class_id, is_active, created_at`,
      [classId, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/users/:id
adminRouter.delete('/users/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    const result = await pool.query(
      `DELETE FROM users
       WHERE id = $1
       RETURNING id`,
      [userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    res.json({ message: '学员已删除' });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/admins
adminRouter.get('/admins', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, username, account, nickname, role, status, created_at
       FROM admins
       ORDER BY created_at DESC`
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/admins
adminRouter.post('/admins', requireSuperAdmin, async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');
    const role = req.body.role;
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);

    if (usernameError || passwordError) {
      sendValidationError(res, usernameError || passwordError);
      return;
    }

    if (role !== 'teacher' && role !== 'super_admin') {
      sendValidationError(res, '请选择有效的账号角色');
      return;
    }

    if (role === 'super_admin' && requireRootAdmin(req, res)) return;

    if (await usernameExistsInAdmins(username) || await usernameExistsInUsers(username)) {
      res.status(409).json({ message: '该账号已存在，请更换账号' });
      return;
    }

    const nickname = normalizeLoginText(req.body.nickname);
    const nicknameError = validateNickname(nickname);

    if (nicknameError) {
      sendValidationError(res, nicknameError);
      return;
    }

    if (await nicknameExistsGlobally(nickname)) {
      res.status(409).json({ message: '该昵称已存在，请更换昵称' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO admins (username, account, nickname, password_hash, role, status)
       VALUES ($1, $1, $2, $3, $4, 'active')
       RETURNING id, username, account, nickname, role, status, created_at`,
      [username, nickname, passwordHash, role]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '该账号已存在，请更换账号' });
      return;
    }

    next(error);
  }
});

// PATCH /api/admin/admins/:id
adminRouter.patch('/admins/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const adminId = normalizeId(req.params.id);
    const nickname = normalizeLoginText(req.body.nickname);
    const nicknameError = validateNickname(nickname);

    if (!adminId) return sendValidationError(res, '账号 id 无效');
    if (req.admin?.adminId === adminId) return res.status(400).json({ message: '初始/当前教导主任不可在此处编辑' });
    if (nicknameError) return sendValidationError(res, nicknameError);
    if (await nicknameExistsGlobally(nickname, { type: 'admin', id: adminId })) return res.status(409).json({ message: '该昵称已存在，请更换昵称' });

    const target = await pool.query('SELECT role FROM admins WHERE id = $1', [adminId]);
    if (target.rowCount === 0) return res.status(404).json({ message: '账号不存在' });
    if (target.rows[0].role === 'super_admin' && requireRootAdmin(req, res)) return;

    const result = await pool.query(
      `UPDATE admins
       SET nickname = $1
       WHERE id = $2
       RETURNING id, username, account, nickname, role, status, created_at`,
      [nickname, adminId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '账号不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/admins/:id/status
adminRouter.patch('/admins/:id/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const adminId = normalizeId(req.params.id);
    const status = req.body.status === 'disabled' || req.body.isActive === false || req.body.isActive === 'false' ? 'disabled' : 'active';

    if (!adminId) {
      sendValidationError(res, '账号 id 无效');
      return;
    }

    if (adminId === req.admin.adminId && status === 'disabled') {
      res.status(400).json({ message: '不能停用当前登录账号' });
      return;
    }

    const target = await pool.query('SELECT role FROM admins WHERE id = $1', [adminId]);
    if (target.rowCount === 0) return res.status(404).json({ message: '账号不存在' });
    if (target.rows[0].role === 'super_admin' && requireRootAdmin(req, res)) return;

    const result = await pool.query(
      `UPDATE admins
       SET status = $1
       WHERE id = $2
       RETURNING id, username, account, nickname, role, status, created_at`,
      [status, adminId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '账号不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/admins/:id/reset-password
adminRouter.post('/admins/:id/reset-password', requireSuperAdmin, async (req, res, next) => {
  try {
    const password = String(req.body.password ?? '');
    const passwordError = validatePassword(password);

    if (passwordError) {
      sendValidationError(res, passwordError);
      return;
    }

    const adminId = normalizeId(req.params.id);
    if (!adminId) return sendValidationError(res, '账号 id 无效');

    const target = await pool.query('SELECT role FROM admins WHERE id = $1', [adminId]);
    if (target.rowCount === 0) return res.status(404).json({ message: '账号不存在' });
    if (target.rows[0].role === 'super_admin' && requireRootAdmin(req, res)) return;

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `UPDATE admins
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, username, role, created_at`,
      [passwordHash, adminId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '老师不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/admins/:id
adminRouter.delete('/admins/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const adminId = normalizeId(req.params.id);

    if (!adminId) {
      sendValidationError(res, '账号 id 无效');
      return;
    }

    if (adminId === req.admin.adminId) {
      res.status(400).json({ message: '不能删除当前登录的教导主任账号' });
      return;
    }

    const adminResult = await pool.query(
      `SELECT id, role FROM admins WHERE id = $1`,
      [adminId]
    );

    if (adminResult.rowCount === 0) {
      res.status(404).json({ message: '账号不存在' });
      return;
    }

    if (adminResult.rows[0].role === 'super_admin' && requireRootAdmin(req, res)) return;

    if (adminResult.rows[0].role === 'teacher') {
      const teacherCountResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM admins WHERE role = 'teacher'`
      );

      if (teacherCountResult.rows[0].count <= 1) {
        res.status(400).json({ message: '至少需要保留一个老师' });
        return;
      }
    }

    await pool.query(
      `DELETE FROM admins
       WHERE id = $1`,
      [adminId]
    );

    res.json({ message: '账号已删除' });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/classes
adminRouter.get('/classes', requireAdmin, async (req, res, next) => {
  try {
    let query;
    const params = [];

    if (isSuperAdmin(req)) {
      query = `
        SELECT
          c.id,
          c.name,
          c.teacher_id,
          a.username AS teacher_name,
          c.is_active,
          c.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', u.id,
                'username', u.username,
                'nickname', u.nickname,
                'is_active', u.is_active,
                'status', u.status,
                'created_at', u.created_at
              ) ORDER BY u.created_at DESC
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'::json
          ) AS students
        FROM teaching_classes c
        LEFT JOIN admins a ON a.id = c.teacher_id
        LEFT JOIN users u ON u.class_id = c.id
        GROUP BY c.id, c.name, c.teacher_id, a.username, c.is_active, c.created_at
        ORDER BY c.created_at DESC
      `;
    } else {
      query = `
        SELECT
          c.id,
          c.name,
          c.teacher_id,
          a.username AS teacher_name,
          c.is_active,
          c.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', u.id,
                'username', u.username,
                'nickname', u.nickname,
                'is_active', u.is_active,
                'status', u.status,
                'created_at', u.created_at
              ) ORDER BY u.created_at DESC
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'::json
          ) AS students
        FROM teaching_classes c
        LEFT JOIN admins a ON a.id = c.teacher_id
        LEFT JOIN users u ON u.class_id = c.id
        WHERE c.teacher_id = $1
        GROUP BY c.id, c.name, c.teacher_id, a.username, c.is_active, c.created_at
        ORDER BY c.created_at DESC
      `;
      params.push(req.admin.adminId);
    }

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/classes
adminRouter.post('/classes', requireSuperAdmin, async (req, res, next) => {
  try {
    const nameError = validateClassName(req.body.name);

    if (nameError) {
      sendValidationError(res, nameError);
      return;
    }

    const name = normalizeLoginText(req.body.name);
    const teacherId = normalizeId(req.body.teacherId);

    if (teacherId) {
      const teacherResult = await pool.query(
        `SELECT id FROM admins WHERE id = $1 AND role = 'teacher'`,
        [teacherId]
      );

      if (teacherResult.rowCount === 0) {
        sendValidationError(res, '负责老师不存在或不是老师角色');
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO teaching_classes (name, teacher_id)
       VALUES ($1, $2)
       RETURNING id, name, teacher_id, is_active, created_at`,
      [name, teacherId || null]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/classes/:id
adminRouter.patch('/classes/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const classId = normalizeId(req.params.id);
    const nameProvided = Object.prototype.hasOwnProperty.call(req.body, 'name');
    const nameError = nameProvided ? validateClassName(req.body.name) : '';

    if (nameError) {
      sendValidationError(res, nameError);
      return;
    }

    const name = normalizeLoginText(req.body.name);
    const teacherIdProvided = Object.prototype.hasOwnProperty.call(req.body, 'teacherId');
    const teacherId = normalizeId(req.body.teacherId);
    const updates = [];
    const params = [];
    let index = 1;

    if (name) {
      updates.push(`name = $${index++}`);
      params.push(name);
    }

    if (teacherIdProvided) {
      if (teacherId) {
        const teacherResult = await pool.query(
          `SELECT id FROM admins WHERE id = $1 AND role = 'teacher'`,
          [teacherId]
        );

        if (teacherResult.rowCount === 0) {
          sendValidationError(res, '负责老师不存在或不是老师角色');
          return;
        }
      }

      updates.push(`teacher_id = $${index++}`);
      params.push(teacherId || null);
    }

    if (updates.length === 0) {
      sendValidationError(res, '请提供要修改的内容');
      return;
    }

    params.push(classId);
    const result = await pool.query(
      `UPDATE teaching_classes
       SET ${updates.join(', ')}
       WHERE id = $${index}
       RETURNING id, name, teacher_id, is_active, created_at`,
      params
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/classes/:id/status
adminRouter.patch('/classes/:id/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const classId = normalizeId(req.params.id);
    const isActive = req.body.isActive === true || req.body.isActive === 'true';

    if (!classId) {
      sendValidationError(res, '班级 id 无效');
      return;
    }

    const result = await pool.query(
      `UPDATE teaching_classes
       SET is_active = $1
       WHERE id = $2
       RETURNING id, name, teacher_id, is_active, created_at`,
      [isActive, classId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/classes/:id
adminRouter.delete('/classes/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const classId = normalizeId(req.params.id);
    if (!classId) return sendValidationError(res, '班级 id 无效');

    const studentCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE class_id = $1', [classId]);
    const studentCount = studentCountResult.rows[0]?.count || 0;
    if (studentCount > 0) {
      res.status(409).json({ message: `该班级仍有 ${studentCount} 名学员，请先转移学员后再删除` });
      return;
    }

    const result = await pool.query(
      `DELETE FROM teaching_classes
       WHERE id = $1
       RETURNING id`,
      [classId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }

    res.json({ message: '班级已删除' });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/users/:userId/assignments
adminRouter.get('/users/:userId/assignments', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权查看该学员' });
      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    const operationsResult = await pool.query(
      `WITH user_operations AS (
         SELECT
           ua.operation_id,
           MIN(ua.created_at) AS created_at,
           MIN(COALESCE(NULLIF(a.nickname, ''), NULLIF(a.username, ''), '老师')) AS admin_username,
           BOOL_AND(ua.is_deleted) AS is_deleted,
           MAX(ua.delete_reason) FILTER (WHERE ua.delete_reason <> '') AS delete_reason
         FROM user_assignments ua
         LEFT JOIN admins a ON a.id = ua.assigned_by_admin_id
         WHERE ua.user_id = $1
         GROUP BY ua.operation_id
       ),
       operation_videos AS (
         SELECT
           ua.operation_id,
           COALESCE(json_agg(
            json_build_object(
             'id', COALESCE(ua.object_id, ua.video_id),
             'object_type', ua.object_type,
             'part_id', ua.part_id,
             'title', COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), '已删除内容'),
             'assignment_id', ua.id,
             'is_deleted', ua.is_deleted,
             'is_video_deleted', ua.object_id IS NULL AND ua.video_id IS NULL,
             'delete_reason', ua.delete_reason
           ) ORDER BY ua.created_at DESC
         ) FILTER (WHERE ua.object_id IS NOT NULL OR ua.video_id IS NOT NULL OR ua.assigned_object_title <> ''), '[]'::json) AS videos
       FROM user_assignments ua
       LEFT JOIN videos v ON v.id = COALESCE(ua.object_id, ua.video_id) AND COALESCE(ua.object_type, 'video') = 'video'
        WHERE ua.user_id = $1
          AND (ua.object_id IS NOT NULL OR ua.video_id IS NOT NULL OR ua.assigned_object_title <> '')
        GROUP BY ua.operation_id
       ),
       operation_requirements AS (
         SELECT
           ua.operation_id,
           COALESCE(NULLIF(MAX(ua.practice_requirement), ''), MAX(ua.message) FILTER (WHERE ua.object_type = 'message'), '') AS practice_requirement,
           COALESCE(NULLIF(MAX(ua.submit_requirement), ''), '') AS submit_requirement
         FROM user_assignments ua
         WHERE ua.user_id = $1
         GROUP BY ua.operation_id
       )
       SELECT
         o.operation_id,
         o.created_at,
         o.admin_username,
         o.is_deleted,
         o.delete_reason,
         COALESCE(ov.videos, '[]'::json) AS videos,
         COALESCE(orq.practice_requirement, '') AS practice_requirement,
         COALESCE(orq.submit_requirement, '') AS submit_requirement
       FROM user_operations o
       LEFT JOIN operation_videos ov ON ov.operation_id = o.operation_id
       LEFT JOIN operation_requirements orq ON orq.operation_id = o.operation_id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    const activeVideosResult = await pool.query(
      `SELECT ua.id AS assignment_id, ua.created_at, COALESCE(ua.object_id, ua.video_id) AS id,
         ua.object_type, ua.part_id,
         COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), v.title, t.name, c.name, kp.name, kpc.name, '已删除内容') AS title,
         COALESCE(v.description, t.description, c.description, kp.description, kpc.description, '') AS description,
         COALESCE(v.cover_url, t.cover, c.cover, kp.cover, kpc.cover, '') AS cover_url
       FROM user_assignments ua
       LEFT JOIN videos v ON v.id = COALESCE(ua.object_id, ua.video_id) AND COALESCE(ua.object_type, 'video') = 'video'
       LEFT JOIN track_points t ON t.id = ua.object_id AND ua.object_type = 'track_point'
       LEFT JOIN track_collections c ON c.id = ua.object_id AND ua.object_type = 'track_collection'
       LEFT JOIN knowledge_points kp ON kp.id = ua.object_id AND ua.object_type = 'knowledge_point'
       LEFT JOIN knowledge_collections kpc ON kpc.id = ua.object_id AND ua.object_type = 'knowledge_collection'
       WHERE ua.user_id = $1 AND (ua.object_id IS NOT NULL OR ua.video_id IS NOT NULL) AND ua.is_deleted = FALSE
       ORDER BY ua.created_at DESC`,
      [userId]
    );

    res.json({
      data: {
        user,
        operations: operationsResult.rows,
        activeVideos: activeVideosResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:userId/assignments
adminRouter.post('/users/:userId/assignments', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);
    const practiceRequirement = normalizeLoginText(req.body.practiceRequirement);
    const submitRequirement = normalizeLoginText(req.body.submitRequirement);
    const legacyMessage = normalizeLoginText(req.body.message);
    const practiceError = practiceRequirement ? validateRequirement(practiceRequirement, '练习要求') : '';
    const submitError = submitRequirement ? validateRequirement(submitRequirement, '提交要求') : '';
    const legacyError = legacyMessage ? validateRequirement(legacyMessage, '练习要求') : '';
    const legacyVideoIds = Array.isArray(req.body.videoIds) ? req.body.videoIds : (req.body.videoId ? [req.body.videoId] : []);
    const rawObjects = Array.isArray(req.body.objects) ? req.body.objects : [];
    if (req.body.objectType && req.body.objectId) rawObjects.push({ objectType: req.body.objectType, objectId: req.body.objectId, partId: req.body.partId });
    legacyVideoIds.forEach((id) => rawObjects.push({ objectType: 'video', objectId: id }));
    const objects = [...new Map(rawObjects.map((item) => {
      const objectType = String(item?.objectType || '').trim();
      return [`${objectType}:${normalizeId(item?.objectId)}:${normalizeId(item?.partId)}`, { objectType, objectId: normalizeId(item?.objectId), partId: normalizeId(item?.partId) }];
    })).values()].filter((item) => item.objectId);

    if (!userId) return sendValidationError(res, '学员 id 无效');
    if (objects.length === 0 && !practiceRequirement && !submitRequirement && !legacyMessage) return sendValidationError(res, '请至少填写一项作业内容（视频作业、练习要求或提交要求）');
    if (practiceError || submitError || legacyError) return sendValidationError(res, practiceError || submitError || legacyError);
    if (!(await ensureAdminCanManageUser(req, userId))) return res.status(403).json({ message: '无权管理该学员' });
    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ message: '学员不存在' });
    if (!user.is_active) return res.status(400).json({ message: '停用学员不可布置新作业' });

    const validated = [];
    for (const object of objects) {
      if (!ASSIGNMENT_OBJECT_TYPES.has(object.objectType)) return res.status(400).json({ message: `不支持的推送对象类型：${object.objectType}` });
      let query;
      let params;
      if (object.objectType === 'video') {
        query = 'SELECT id, title, NULL::int AS part_id, id AS video_id FROM videos WHERE id = $1'; params = [object.objectId];
      } else if (object.objectType === 'track_point') {
        query = 'SELECT id, name AS title, NULL::int AS part_id, NULL::int AS video_id FROM track_points WHERE id = $1'; params = [object.objectId];
      } else if (object.objectType === 'track_collection') {
        query = 'SELECT id, name AS title, NULL::int AS part_id, NULL::int AS video_id FROM track_collections WHERE id = $1'; params = [object.objectId];
      } else if (object.objectType === 'knowledge_point') {
        query = 'SELECT id, name AS title, NULL::int AS part_id, NULL::int AS video_id FROM knowledge_points WHERE id = $1'; params = [object.objectId];
      } else if (object.objectType === 'knowledge_collection') {
        query = 'SELECT id, name AS title, NULL::int AS part_id, NULL::int AS video_id FROM knowledge_collections WHERE id = $1'; params = [object.objectId];
      } else if (object.objectType === 'track_part') {
        query = `SELECT tp.id, CONCAT(t.name, '-', tp.title) AS title, tp.id AS part_id, tp.video_id
                 FROM track_parts tp JOIN track_points t ON t.id = tp.track_id
                 WHERE tp.id = $1 AND tp.track_id = COALESCE($2, tp.track_id)`;
        params = [object.partId || object.objectId, object.partId ? object.objectId : null];
      } else {
        query = `SELECT kp.id, CONCAT(kpt.name, '-', kp.title) AS title, kp.id AS part_id, kp.video_id
                 FROM knowledge_parts kp JOIN knowledge_points kpt ON kpt.id = kp.knowledge_point_id
                 WHERE kp.id = $1 AND kp.knowledge_point_id = COALESCE($2, kp.knowledge_point_id)`;
        params = [object.partId || object.objectId, object.partId ? object.objectId : null];
      }
      const result = await pool.query(query, params);
      if (!result.rows[0]) return res.status(404).json({ message: `推送对象不存在：${object.objectType} ${object.objectId}` });
      validated.push({ ...object, ...result.rows[0], objectId: object.objectType.endsWith('_part') ? result.rows[0].part_id : object.objectId });
    }

    const newObjects = validated;
    if (newObjects.length > MAX_ACTIVE_VIDEO_ASSIGNMENTS) return sendValidationError(res, `本次最多选择 ${MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个作业对象`);

    const operationResult = await pool.query(`SELECT nextval('user_assignments_operation_id_seq') AS operation_id`);
    const operationId = operationResult.rows[0].operation_id;
    const insertedRows = [];
    for (const item of newObjects) {
      const result = await pool.query(`INSERT INTO user_assignments (operation_id, user_id, video_id, object_type, object_id, part_id, message, practice_requirement, submit_requirement, assigned_by_admin_id, assigned_video_title, assigned_object_title) VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, $10, $10) RETURNING id, operation_id, user_id, video_id, object_type, object_id, part_id, message, practice_requirement, submit_requirement, is_deleted, delete_reason, deleted_at, created_at`, [operationId, userId, item.video_id || null, item.objectType, item.objectId, item.partId || null, practiceRequirement || legacyMessage, submitRequirement, req.admin.adminId, item.title]);
      insertedRows.push(result.rows[0]);
    }
    if (newObjects.length === 0 || (legacyMessage && !practiceRequirement && !submitRequirement)) {
      const result = await pool.query(`INSERT INTO user_assignments (operation_id, user_id, video_id, object_type, object_id, message, practice_requirement, submit_requirement, assigned_by_admin_id) VALUES ($1, $2, NULL, 'message', NULL, $3, $4, $5, $6) RETURNING id, operation_id, user_id, video_id, object_type, object_id, message, practice_requirement, submit_requirement, is_deleted, delete_reason, deleted_at, created_at`, [operationId, userId, legacyMessage, practiceRequirement || legacyMessage, submitRequirement, req.admin.adminId]);
      insertedRows.push(result.rows[0]);
    }
    res.status(201).json({ data: { operationId, rows: insertedRows } });
  } catch (error) { next(error); }
});

// POST /api/admin/users/:userId/message
adminRouter.post('/users/:userId/message', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);
    const practiceRequirement = normalizeLoginText(req.body.practiceRequirement ?? req.body.message);
    const submitRequirement = normalizeLoginText(req.body.submitRequirement);
    const practiceError = practiceRequirement ? validateRequirement(practiceRequirement, '练习要求') : '';
    const submitError = submitRequirement ? validateRequirement(submitRequirement, '提交要求') : '';

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    if (practiceError || submitError) {
      sendValidationError(res, practiceError || submitError);
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学员' });
      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      res.status(404).json({ message: '学员不存在' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO user_assignments (user_id, video_id, object_type, message, practice_requirement, submit_requirement, assigned_by_admin_id)
       VALUES ($1, NULL, 'message', '', $2, $3, $4)
       RETURNING id, user_id, video_id, message, practice_requirement, submit_requirement, is_deleted, delete_reason, deleted_at, created_at`,
      [userId, practiceRequirement, submitRequirement, req.admin.adminId]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/assignments/:id/cancel
adminRouter.patch('/assignments/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const assignmentId = normalizeId(req.params.id);

    if (!assignmentId) {
      sendValidationError(res, '主页课程设置记录 id 无效');
      return;
    }

    const assignmentResult = await pool.query(
      `SELECT user_id FROM user_assignments WHERE id = $1`,
      [assignmentId]
    );

    if (assignmentResult.rowCount === 0) {
      res.status(404).json({ message: '推送记录不存在' });
      return;
    }

    if (!(await ensureAdminCanManageUser(req, assignmentResult.rows[0].user_id))) {
      res.status(403).json({ message: '无权管理该学员' });
      return;
    }

    const result = await pool.query(
      `UPDATE user_assignments
       SET is_deleted = TRUE,
           delete_reason = '取消推送',
           deleted_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND video_id IS NOT NULL
         AND is_deleted = FALSE
       RETURNING id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
      [assignmentId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '正在置顶的课程视频不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/assignments/:id/delete
adminRouter.patch('/assignments/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const assignmentId = normalizeId(req.params.id);
    const reason = normalizeLoginText(req.body.reason);
    const reasonError = validateDeleteReason(reason);

    if (!assignmentId) {
      sendValidationError(res, '推送记录 id 无效');
      return;
    }

    if (reasonError) {
      sendValidationError(res, reasonError);
      return;
    }

    const assignmentResult = await pool.query(
      `SELECT user_id, operation_id FROM user_assignments WHERE id = $1`,
      [assignmentId]
    );

    if (assignmentResult.rowCount === 0) {
      res.status(404).json({ message: '推送记录不存在' });
      return;
    }

    if (!(await ensureAdminCanManageUser(req, assignmentResult.rows[0].user_id))) {
      res.status(403).json({ message: '无权管理该学员' });
      return;
    }

    const latestOperationResult = await pool.query(
      `SELECT operation_id FROM user_assignments
       WHERE user_id = $1 AND is_deleted = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [assignmentResult.rows[0].user_id]
    );
    if (Number(latestOperationResult.rows[0]?.operation_id) === Number(assignmentResult.rows[0].operation_id)) {
      res.status(400).json({ message: '最新作业不能删除，请先布置一条新的作业' });
      return;
    }

    const result = await pool.query(
      `UPDATE user_assignments
       SET is_deleted = TRUE,
           delete_reason = $1,
           deleted_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
      [reason, assignmentId]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/operations/:operationId/delete
adminRouter.patch('/operations/:operationId/delete', requireAdmin, async (req, res, next) => {
  try {
    const operationId = normalizeId(req.params.operationId);
    const reason = normalizeLoginText(req.body.reason);
    const reasonError = validateDeleteReason(reason);

    if (!operationId) {
      sendValidationError(res, '操作 id 无效');
      return;
    }

    if (reasonError) {
      sendValidationError(res, reasonError);
      return;
    }

    const operationResult = await pool.query(
      `SELECT DISTINCT user_id FROM user_assignments WHERE operation_id = $1`,
      [operationId]
    );

    if (operationResult.rowCount === 0) {
      res.status(404).json({ message: '操作不存在' });
      return;
    }

    for (const row of operationResult.rows) {
      if (!(await ensureAdminCanManageUser(req, row.user_id))) {
        res.status(403).json({ message: '无权管理该学员' });
        return;
      }
    }

    for (const row of operationResult.rows) {
      const latestOperationResult = await pool.query(
        `SELECT operation_id
         FROM user_assignments
         WHERE user_id = $1 AND is_deleted = FALSE
         ORDER BY created_at DESC
         LIMIT 1`,
        [row.user_id]
      );
      if (Number(latestOperationResult.rows[0]?.operation_id) === operationId) {
        res.status(400).json({ message: '最新作业不能删除，请先布置一条新的作业' });
        return;
      }
    }

    const result = await pool.query(
      `UPDATE user_assignments
       SET is_deleted = TRUE,
           delete_reason = $1,
           deleted_at = CURRENT_TIMESTAMP
       WHERE operation_id = $2
         AND is_deleted = FALSE
       RETURNING id, user_id, video_id, message, practice_requirement, submit_requirement, is_deleted, delete_reason, deleted_at, created_at`,
      [reason, operationId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '该操作下没有可删除的记录' });
      return;
    }

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});
