import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearAdminCookie, getAdminCookieOptions, requireAdmin, requireSuperAdmin, signAdminToken } from './auth.js';

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 72;
const CLASS_NAME_MAX_LENGTH = 100;
const MESSAGE_MAX_LENGTH = 1000;
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

  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return `账号长度必须是 ${USERNAME_MIN_LENGTH} 到 ${USERNAME_MAX_LENGTH} 个字符`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return '账号只能包含英文、数字和下划线';
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

function validateMessage(message) {
  if (message && isInvalidTextValue(message)) {
    return '留言不能是 null、undefined、NaN 这类无意义内容';
  }

  if (message.length > MESSAGE_MAX_LENGTH) {
    return `留言最多 ${MESSAGE_MAX_LENGTH} 个字`;
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
    `SELECT id, username, class_id, is_active, created_at
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
    `SELECT id FROM admins WHERE username = $1`,
    [username]
  );

  return result.rowCount > 0;
}

async function usernameExistsInSuperAdmins(username) {
  const result = await pool.query(
    `SELECT id FROM admins WHERE username = $1 AND role = 'super_admin'`,
    [username]
  );

  return result.rowCount > 0;
}

async function usernameExistsInUsers(username) {
  const result = await pool.query(
    `SELECT id FROM users WHERE username = $1`,
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
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );

    if (userResult.rows.length > 0) {
      res.status(403).json({ message: '没有这个老师' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, role, status
       FROM admins
       WHERE username = $1`,
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
    res.json({ data: { username: admin.username, role: admin.role } });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/me
adminRouter.get('/me', requireAdmin, (req, res) => {
  res.json({
    data: {
      id: req.admin.adminId,
      username: req.admin.username,
      role: req.admin.role
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
    let query = `SELECT id, username, class_id, is_active, created_at FROM users`;
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

    if (await usernameExistsInAdmins(username)) {
      res.status(409).json({ message: '不能创建和老师或教导主任同名的学员' });
      return;
    }

    let classId = normalizeId(req.body.classId);

    if (isSuperAdmin(req)) {
      if (!classId) {
        sendValidationError(res, '请选择班级');
        return;
      }

      const classResult = await pool.query(
        `SELECT id FROM teaching_classes WHERE id = $1`,
        [classId]
      );

      if (classResult.rowCount === 0) {
        sendValidationError(res, '班级不存在');
        return;
      }
    } else {
      const classIds = await findAdminClassIds(req.admin.adminId);

      if (classIds.length === 0) {
        res.status(403).json({ message: '您还没有被分配到班级，无法创建学员' });
        return;
      }

      classId = classIds[0];
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, account, nickname, password_hash, class_id, status, is_active)
       VALUES ($1, $1, $1, $2, $3, 'active', TRUE)
       RETURNING id, username, account, nickname, class_id, status, is_active, created_at`,
      [username, passwordHash, classId]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个学员账号已经存在' });
      return;
    }

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
           status = CASE WHEN $1 THEN 'active' ELSE 'disabled' END
       WHERE id = $2
       RETURNING id, username, class_id, is_active, created_at`,
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

// PATCH /api/admin/users/:id/class
// 教导主任给学员转班；老师不能转班。
adminRouter.patch('/users/:id/class', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const classId = normalizeId(req.body.classId);

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    if (!classId) {
      sendValidationError(res, '请选择目标班级');
      return;
    }

    const classResult = await pool.query(
      `SELECT id FROM teaching_classes WHERE id = $1`,
      [classId]
    );

    if (classResult.rowCount === 0) {
      res.status(404).json({ message: '班级不存在' });
      return;
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

    if (role === 'teacher' && await usernameExistsInSuperAdmins(username)) {
      res.status(409).json({ message: '不能创建和教导主任同名的老师' });
      return;
    }

    if (await usernameExistsInUsers(username)) {
      res.status(409).json({ message: '不能创建和学员同名的老师或教导主任' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO admins (username, account, nickname, password_hash, role, status)
       VALUES ($1, $1, $1, $2, $3, 'active')
       RETURNING id, username, account, nickname, role, status, created_at`,
      [username, passwordHash, role]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个老师账号已经存在' });
      return;
    }

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

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `UPDATE admins
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, username, role, created_at`,
      [passwordHash, req.params.id]
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
          c.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', u.id,
                'username', u.username,
                'is_active', u.is_active,
                'created_at', u.created_at
              ) ORDER BY u.created_at DESC
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'::json
          ) AS students
        FROM teaching_classes c
        LEFT JOIN admins a ON a.id = c.teacher_id
        LEFT JOIN users u ON u.class_id = c.id
        GROUP BY c.id, c.name, c.teacher_id, a.username, c.created_at
        ORDER BY c.created_at DESC
      `;
    } else {
      query = `
        SELECT
          c.id,
          c.name,
          c.teacher_id,
          a.username AS teacher_name,
          c.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id', u.id,
                'username', u.username,
                'is_active', u.is_active,
                'created_at', u.created_at
              ) ORDER BY u.created_at DESC
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'::json
          ) AS students
        FROM teaching_classes c
        LEFT JOIN admins a ON a.id = c.teacher_id
        LEFT JOIN users u ON u.class_id = c.id
        WHERE c.teacher_id = $1
        GROUP BY c.id, c.name, c.teacher_id, a.username, c.created_at
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

    if (!teacherId) {
      sendValidationError(res, '请选择负责老师');
      return;
    }

    const teacherResult = await pool.query(
      `SELECT id FROM admins WHERE id = $1 AND role = 'teacher'`,
      [teacherId]
    );

    if (teacherResult.rowCount === 0) {
      sendValidationError(res, '负责老师不存在或不是老师角色');
      return;
    }

    const result = await pool.query(
      `INSERT INTO teaching_classes (name, teacher_id)
       VALUES ($1, $2)
       RETURNING id, name, teacher_id, created_at`,
      [name, teacherId]
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
    const nameError = validateClassName(req.body.name);

    if (nameError) {
      sendValidationError(res, nameError);
      return;
    }

    const name = normalizeLoginText(req.body.name);
    const teacherId = normalizeId(req.body.teacherId);
    const updates = [];
    const params = [];
    let index = 1;

    if (name) {
      updates.push(`name = $${index++}`);
      params.push(name);
    }

    if (teacherId) {
      const teacherResult = await pool.query(
        `SELECT id FROM admins WHERE id = $1 AND role = 'teacher'`,
        [teacherId]
      );

      if (teacherResult.rowCount === 0) {
        sendValidationError(res, '负责老师不存在或不是老师角色');
        return;
      }

      updates.push(`teacher_id = $${index++}`);
      params.push(teacherId);
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
       RETURNING id, name, teacher_id, created_at`,
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

// DELETE /api/admin/classes/:id
adminRouter.delete('/classes/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const classId = normalizeId(req.params.id);
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
           MIN(a.username) AS admin_username,
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
             'title', COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), v.title, '已删除内容'),
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
       operation_messages AS (
         SELECT
           ua.operation_id,
           MAX(ua.message) AS message
         FROM user_assignments ua
         WHERE ua.user_id = $1 AND ua.object_type = 'message' AND ua.message <> ''
         GROUP BY ua.operation_id
       )
       SELECT
         o.operation_id,
         o.created_at,
         o.admin_username,
         o.is_deleted,
         o.delete_reason,
         COALESCE(ov.videos, '[]'::json) AS videos,
         COALESCE(om.message, '') AS message
       FROM user_operations o
       LEFT JOIN operation_videos ov ON ov.operation_id = o.operation_id
       LEFT JOIN operation_messages om ON om.operation_id = o.operation_id
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

    const latestMessageResult = await pool.query(
      `SELECT message, created_at
       FROM user_assignments
       WHERE user_id = $1
         AND object_type = 'message'
         AND is_deleted = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    res.json({
      data: {
        user,
        operations: operationsResult.rows,
        activeVideos: activeVideosResult.rows,
        message: latestMessageResult.rows[0]?.message || ''
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
    const message = normalizeLoginText(req.body.message);
    const messageError = message ? validateMessage(message) : '';
    const legacyVideoIds = Array.isArray(req.body.videoIds) ? req.body.videoIds : (req.body.videoId ? [req.body.videoId] : []);
    const rawObjects = Array.isArray(req.body.objects) ? req.body.objects : [];
    if (req.body.objectType && req.body.objectId) rawObjects.push({ objectType: req.body.objectType, objectId: req.body.objectId, partId: req.body.partId });
    legacyVideoIds.forEach((id) => rawObjects.push({ objectType: 'video', objectId: id }));
    const objects = [...new Map(rawObjects.map((item) => {
      const objectType = String(item?.objectType || '').trim();
      return [`${objectType}:${normalizeId(item?.objectId)}:${normalizeId(item?.partId)}`, { objectType, objectId: normalizeId(item?.objectId), partId: normalizeId(item?.partId) }];
    })).values()].filter((item) => item.objectId);

    if (!userId) return sendValidationError(res, '学员 id 无效');
    if (objects.length === 0 && !message) return sendValidationError(res, '请选择要推送的内容或填写留言');
    if (messageError) return sendValidationError(res, messageError);
    if (!(await ensureAdminCanManageUser(req, userId))) return res.status(403).json({ message: '无权管理该学员' });
    if (!await findUserById(userId)) return res.status(404).json({ message: '学员不存在' });

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
        query = 'SELECT tp.id, CONCAT(\'P\', tp.part_no, \' · \', tp.title) AS title, tp.id AS part_id, tp.video_id FROM track_parts tp WHERE tp.id = $1 AND tp.track_id = COALESCE($2, tp.track_id)'; params = [object.partId || object.objectId, object.partId ? object.objectId : null];
      } else {
        query = 'SELECT kp.id, CONCAT(\'P\', kp.part_no, \' · \' , kp.title) AS title, kp.id AS part_id, kp.video_id FROM knowledge_parts kp WHERE kp.id = $1 AND kp.knowledge_point_id = COALESCE($2, kp.knowledge_point_id)'; params = [object.partId || object.objectId, object.partId ? object.objectId : null];
      }
      const result = await pool.query(query, params);
      if (!result.rows[0]) return res.status(404).json({ message: `推送对象不存在：${object.objectType} ${object.objectId}` });
      validated.push({ ...object, ...result.rows[0], objectId: object.objectType.endsWith('_part') ? result.rows[0].part_id : object.objectId });
    }

    const activeResult = await pool.query(`SELECT object_type, object_id, COALESCE(part_id, 0) AS part_id FROM user_assignments WHERE user_id = $1 AND is_deleted = FALSE AND (object_id IS NOT NULL OR video_id IS NOT NULL)`, [userId]);
    const activeKeys = new Set(activeResult.rows.map((row) => `${row.object_type}:${row.object_id || row.video_id}:${row.part_id || 0}`));
    const newObjects = validated.filter((item) => !activeKeys.has(`${item.objectType}:${item.objectId}:${item.partId || 0}`));
    if (newObjects.length > 0 && activeKeys.size + newObjects.length > MAX_ACTIVE_VIDEO_ASSIGNMENTS) return sendValidationError(res, `同一个学员最多只能同时推送 ${MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个对象`);

    const operationResult = await pool.query(`SELECT nextval('user_assignments_operation_id_seq') AS operation_id`);
    const operationId = operationResult.rows[0].operation_id;
    const insertedRows = [];
    for (const item of newObjects) {
      const result = await pool.query(`INSERT INTO user_assignments (operation_id, user_id, video_id, object_type, object_id, part_id, message, assigned_by_admin_id, assigned_video_title, assigned_object_title) VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $8) RETURNING id, operation_id, user_id, video_id, object_type, object_id, part_id, message, is_deleted, delete_reason, deleted_at, created_at`, [operationId, userId, item.video_id || null, item.objectType, item.objectId, item.partId || null, req.admin.adminId, item.title]);
      insertedRows.push(result.rows[0]);
    }
    if (message) {
      const result = await pool.query(`INSERT INTO user_assignments (operation_id, user_id, video_id, object_type, object_id, message, assigned_by_admin_id) VALUES ($1, $2, NULL, 'message', NULL, $3, $4) RETURNING id, operation_id, user_id, video_id, object_type, object_id, message, is_deleted, delete_reason, deleted_at, created_at`, [operationId, userId, message, req.admin.adminId]);
      insertedRows.push(result.rows[0]);
    }
    res.status(201).json({ data: { operationId, rows: insertedRows } });
  } catch (error) { next(error); }
});

// POST /api/admin/users/:userId/message
adminRouter.post('/users/:userId/message', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);
    const message = normalizeLoginText(req.body.message);
    const messageError = validateMessage(message);

    if (!userId) {
      sendValidationError(res, '学员 id 无效');
      return;
    }

    if (messageError) {
      sendValidationError(res, messageError);
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
      `INSERT INTO user_assignments (user_id, video_id, message, assigned_by_admin_id)
       VALUES ($1, NULL, $2, $3)
       RETURNING id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
      [userId, message, req.admin.adminId]
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

    const result = await pool.query(
      `UPDATE user_assignments
       SET is_deleted = TRUE,
           delete_reason = $1,
           deleted_at = CURRENT_TIMESTAMP
       WHERE operation_id = $2
         AND is_deleted = FALSE
       RETURNING id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
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
