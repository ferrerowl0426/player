import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearAdminCookie, getAdminCookieOptions, requireAdmin, signAdminToken } from './auth.js';

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 72;
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

async function hashPassword(password) {
  // bcrypt 会给密码加盐再哈希；数据库只保存哈希值，不保存明文密码。
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

async function findUserById(userId) {
  const result = await pool.query(
    `SELECT id, username, is_active, created_at
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
    res.cookie(config.auth.adminCookieName, token, getAdminCookieOptions());
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
  clearAdminCookie(res);
  res.json({ message: '已退出登录' });
});

// GET /api/admin/users
// 管理员查看普通用户列表，用来创建账号、重置密码、启用或禁用用户。
adminRouter.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, username, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users
// 普通用户由管理员创建，密码线下分发给对应用户。
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

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, is_active, created_at`,
      [username, passwordHash]
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
// 第一版不做用户自己改密码，统一由管理员重置后线下告知。
adminRouter.post('/users/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const password = String(req.body.password ?? '');
    const passwordError = validatePassword(password);

    if (passwordError) {
      sendValidationError(res, passwordError);
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, username, is_active, created_at`,
      [passwordHash, req.params.id]
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
// 禁用用户后，该用户不能再登录；历史数据仍然保留。
adminRouter.patch('/users/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const isActive = Boolean(req.body.isActive);
    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, is_active, created_at`,
      [isActive, req.params.id]
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
// 管理员列表用于确认后台还有哪些管理员账号。
adminRouter.get('/admins', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, username, created_at
       FROM admins
       ORDER BY created_at DESC`
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/admins
// 管理员可以创建其他管理员，方便多人维护后台。
adminRouter.post('/admins', requireAdmin, async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);

    if (usernameError || passwordError) {
      sendValidationError(res, usernameError || passwordError);
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [username, passwordHash]
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
// 管理员忘记密码时，由另一个管理员重置密码。
adminRouter.post('/admins/:id/reset-password', requireAdmin, async (req, res, next) => {
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
       RETURNING id, username, created_at`,
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
// 不允许删除最后一个管理员，否则后台会失去入口。
adminRouter.delete('/admins/:id', requireAdmin, async (req, res, next) => {
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

// GET /api/admin/users/:userId/assignments
// 管理员查看某个用户的全部推送历史，包括已经软删除的记录。
adminRouter.get('/users/:userId/assignments', requireAdmin, async (req, res, next) => {
  try {
    const userId = normalizeId(req.params.userId);

    if (!userId) {
      sendValidationError(res, '用户 id 无效');
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
// 管理员一次操作可以同时更新推送视频和留言，所有相关记录共享同一个 operation_id。
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
// 留言板是独立更新，不和视频推送绑定。
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
// 取消正在推送的视频：历史记录保留，但不再出现在用户的置顶视频区。
adminRouter.patch('/assignments/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const assignmentId = normalizeId(req.params.id);

    if (!assignmentId) {
      sendValidationError(res, '推送记录 id 无效');
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
// 推送历史是教学记录，删除时只做软删除，并强制记录原因。
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

    const result = await pool.query(
      `UPDATE user_assignments
       SET is_deleted = TRUE,
           delete_reason = $1,
           deleted_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, user_id, video_id, message, is_deleted, delete_reason, deleted_at, created_at`,
      [reason, assignmentId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '推送记录不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/operations/:operationId/delete
// 删除整个操作聚合：把该 operation_id 下所有未删除的记录软删除。
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

