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

async function findAdminClassId(adminId) {
  const result = await pool.query(
    `SELECT id FROM teaching_classes WHERE teacher_id = $1 LIMIT 1`,
    [adminId]
  );
  return result.rows[0]?.id || null;
}

async function ensureAdminCanManageUser(req, userId) {
  if (isSuperAdmin(req)) {
    return true;
  }

  const classId = await findAdminClassId(req.admin.adminId);

  if (!classId) {
    return false;
  }

  const result = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND class_id = $2`,
    [userId, classId]
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

export const adminRouter = Router();

// POST /api/admin/login
adminRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      res.status(400).json({ message: '请填写管理员账号和密码' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, role
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
      const classId = await findAdminClassId(req.admin.adminId);

      if (!classId) {
        res.json({ data: [] });
        return;
      }

      query += ` WHERE class_id = $1`;
      params.push(classId);
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
      classId = await findAdminClassId(req.admin.adminId);

      if (!classId) {
        res.status(403).json({ message: '您还没有被分配到班级，无法创建学生' });
        return;
      }
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, class_id)
       VALUES ($1, $2, $3)
       RETURNING id, username, class_id, is_active, created_at`,
      [username, passwordHash, classId]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个普通用户账号已经存在' });
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
      res.status(403).json({ message: '无权管理该学生' });
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
      res.status(404).json({ message: '普通用户不存在' });
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
    const isActive = Boolean(req.body.isActive);

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学生' });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, class_id, is_active, created_at`,
      [isActive, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '普通用户不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/class
// 超级管理员给学生转班；老师不能转班。
adminRouter.patch('/users/:id/class', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.id);
    const classId = normalizeId(req.body.classId);

    if (!userId) {
      sendValidationError(res, '用户 id 无效');
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
      res.status(404).json({ message: '普通用户不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/admins
adminRouter.get('/admins', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, created_at
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
    const role = req.body.role === 'teacher' ? 'teacher' : 'super_admin';
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);

    if (usernameError || passwordError) {
      sendValidationError(res, usernameError || passwordError);
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO admins (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role, created_at`,
      [username, passwordHash, role]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个管理员账号已经存在' });
      return;
    }

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
      res.status(404).json({ message: '管理员不存在' });
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
    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM admins');

    if (countResult.rows[0].count <= 1) {
      res.status(400).json({ message: '至少需要保留一个管理员' });
      return;
    }

    const result = await pool.query(
      `DELETE FROM admins
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '管理员不存在' });
      return;
    }

    res.json({ message: '管理员已删除' });
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
      sendValidationError(res, '用户 id 无效');
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权查看该学生' });
      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      res.status(404).json({ message: '普通用户不存在' });
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
               'id', v.id,
               'title', v.title,
               'cover_url', v.cover_url,
               'assignment_id', ua.id,
               'is_deleted', ua.is_deleted,
               'delete_reason', ua.delete_reason
             ) ORDER BY ua.created_at DESC
           ) FILTER (WHERE v.id IS NOT NULL), '[]'::json) AS videos
         FROM user_assignments ua
         LEFT JOIN videos v ON v.id = ua.video_id
         WHERE ua.user_id = $1 AND ua.video_id IS NOT NULL
         GROUP BY ua.operation_id
       ),
       operation_messages AS (
         SELECT
           ua.operation_id,
           MAX(ua.message) AS message
         FROM user_assignments ua
         WHERE ua.user_id = $1 AND ua.video_id IS NULL AND ua.message <> ''
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
      `SELECT
         ua.id AS assignment_id,
         ua.created_at,
         v.id,
         v.title,
         v.description,
         v.cover_url
       FROM user_assignments ua
       JOIN videos v ON v.id = ua.video_id
       WHERE ua.user_id = $1
         AND ua.video_id IS NOT NULL
         AND ua.is_deleted = FALSE
       ORDER BY ua.created_at DESC`,
      [userId]
    );

    const latestMessageResult = await pool.query(
      `SELECT message, created_at
       FROM user_assignments
       WHERE user_id = $1
         AND video_id IS NULL
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
    const rawVideoIds = Array.isArray(req.body.videoIds) ? req.body.videoIds : [req.body.videoId];
    const videoIds = [...new Set(rawVideoIds.map(normalizeId).filter(Boolean))];
    const message = normalizeLoginText(req.body.message);
    const messageError = message ? validateMessage(message) : '';

    if (!userId) {
      sendValidationError(res, '用户 id 无效');
      return;
    }

    if (videoIds.length === 0 && !message) {
      sendValidationError(res, '请选择要推送的视频或填写留言');
      return;
    }

    if (messageError) {
      sendValidationError(res, messageError);
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学生' });
      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      res.status(404).json({ message: '普通用户不存在' });
      return;
    }

    if (videoIds.length > 0 && !(await ensureVideosExist(videoIds))) {
      res.status(404).json({ message: '部分视频不存在' });
      return;
    }

    const activeResult = await pool.query(
      `SELECT video_id
       FROM user_assignments
       WHERE user_id = $1
         AND video_id IS NOT NULL
         AND is_deleted = FALSE`,
      [userId]
    );
    const activeVideoIds = new Set(activeResult.rows.map((row) => row.video_id));
    const newVideoIds = videoIds.filter((videoId) => !activeVideoIds.has(videoId));

    if (newVideoIds.length > 0 && activeVideoIds.size + newVideoIds.length > MAX_ACTIVE_VIDEO_ASSIGNMENTS) {
      sendValidationError(res, `同一个用户最多只能同时推送 ${MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个视频`);
      return;
    }

    const operationResult = await pool.query(
      `SELECT nextval('user_assignments_operation_id_seq') AS operation_id`
    );
    const operationId = operationResult.rows[0].operation_id;
    const insertedRows = [];

    if (newVideoIds.length > 0) {
      const videoResult = await pool.query(
        `INSERT INTO user_assignments (operation_id, user_id, video_id, message, assigned_by_admin_id)
         SELECT $1, $2, unnest($3::int[]), '', $4
         RETURNING id, operation_id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
        [operationId, userId, newVideoIds, req.admin.adminId]
      );
      insertedRows.push(...videoResult.rows);
    }

    if (message) {
      const messageResult = await pool.query(
        `INSERT INTO user_assignments (operation_id, user_id, video_id, message, assigned_by_admin_id)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING id, operation_id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
        [operationId, userId, message, req.admin.adminId]
      );
      insertedRows.push(...messageResult.rows);
    }

    res.status(201).json({ data: { operationId, rows: insertedRows } });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:userId/message
adminRouter.post('/users/:userId/message', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);
    const message = normalizeLoginText(req.body.message);
    const messageError = validateMessage(message);

    if (!userId) {
      sendValidationError(res, '用户 id 无效');
      return;
    }

    if (messageError) {
      sendValidationError(res, messageError);
      return;
    }

    if (!(await ensureAdminCanManageUser(req, userId))) {
      res.status(403).json({ message: '无权管理该学生' });
      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      res.status(404).json({ message: '普通用户不存在' });
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
      sendValidationError(res, '推送记录 id 无效');
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
      res.status(403).json({ message: '无权管理该学生' });
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
      res.status(404).json({ message: '正在推送的视频不存在' });
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
      res.status(403).json({ message: '无权管理该学生' });
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
        res.status(403).json({ message: '无权管理该学生' });
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
