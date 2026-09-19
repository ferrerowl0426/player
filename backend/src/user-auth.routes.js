import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearUserCookie, getUserCookieOptions, requireUser, signUserToken } from './auth.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

function assignmentTitleExpression() {
  return `COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), v.title, t.name, c.name, kp.name, kpc.name, parent_t.name, parent_kp.name, '')`;
}

function assignmentSnapshotTitleExpression() {
  return `COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), '已删除内容')`;
}

function assignmentCoverExpression() {
  return `COALESCE(v.cover_url, t.cover, c.cover, kp.cover, kpc.cover, parent_t.cover, parent_kp.cover, '')`;
}

function assignmentNavigationExpression() {
  return `CASE
           WHEN COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'video' THEN '/videos/' || COALESCE(ua.object_id, ua.video_id)
           WHEN ua.object_type = 'track_point' THEN '/tracks/' || ua.object_id
           WHEN ua.object_type = 'track_collection' THEN '/tracks/collections/' || ua.object_id
           WHEN ua.object_type = 'knowledge_point' THEN '/knowledge/' || ua.object_id
           WHEN ua.object_type = 'knowledge_collection' THEN '/knowledge/collections/' || ua.object_id
           WHEN ua.object_type = 'track_part' THEN '/tracks/' || parent_t.id || '?part=' || COALESCE(ua.part_id, ua.object_id)
           WHEN ua.object_type = 'knowledge_part' THEN '/knowledge/' || parent_kp.id || '?part=' || COALESCE(ua.part_id, ua.object_id)
           ELSE NULL
         END`;
}

function assignmentJoins() {
  return `LEFT JOIN videos v ON v.id = COALESCE(ua.object_id, ua.video_id) AND COALESCE(ua.object_type, 'video') = 'video'
       LEFT JOIN track_points t ON t.id = ua.object_id AND ua.object_type = 'track_point'
       LEFT JOIN track_collections c ON c.id = ua.object_id AND ua.object_type = 'track_collection'
       LEFT JOIN knowledge_points kp ON kp.id = ua.object_id AND ua.object_type = 'knowledge_point'
       LEFT JOIN knowledge_collections kpc ON kpc.id = ua.object_id AND ua.object_type = 'knowledge_collection'
       LEFT JOIN track_parts tp ON tp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'track_part'
       LEFT JOIN track_points parent_t ON parent_t.id = tp.track_id
       LEFT JOIN knowledge_parts kpp ON kpp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'knowledge_part'
       LEFT JOIN knowledge_points parent_kp ON parent_kp.id = kpp.knowledge_point_id
       LEFT JOIN admins a ON a.id = ua.assigned_by_admin_id`;
}

function liveAssignmentFilter() {
  return `(COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'message'
           OR (COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'video' AND v.id IS NOT NULL)
           OR (ua.object_type = 'track_point' AND t.id IS NOT NULL)
           OR (ua.object_type = 'track_collection' AND c.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_point' AND kp.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_collection' AND kpc.id IS NOT NULL)
           OR (ua.object_type = 'track_part' AND tp.id IS NOT NULL AND parent_t.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_part' AND kpp.id IS NOT NULL AND parent_kp.id IS NOT NULL))`;
}

export const userAuthRouter = Router();

// POST /api/user/login
// 学员登录成功后，后端把 JWT 写入 HttpOnly Cookie。
// 这样前端不需要保存 token，浏览器后续请求会自动携带登录状态。
userAuthRouter.post('/login', async (req, res, next) => {
  try {
    const username = normalizeLoginText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
      res.status(400).json({ message: '请填写学员账号和密码' });
      return;
    }

    // 学员登录时，如果输入的是老师/教导主任账号，明确提示角色不匹配。
    const adminResult = await pool.query(
      `SELECT id FROM admins WHERE account = $1 OR username = $1`,
      [username]
    );

    if (adminResult.rows.length > 0) {
      res.status(403).json({ message: '没有这个学生' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, account, nickname, password_hash, status, is_active
       FROM users
       WHERE account = $1 OR username = $1`,
      [username]
    );

    const user = result.rows[0];
    const passwordMatched = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!passwordMatched) {
      res.status(401).json({ message: '学员账号或密码错误' });
      return;
    }

    const token = signUserToken(user);
    res.cookie(config.auth.userCookieName, token, getUserCookieOptions());
    res.json({ data: { id: user.id, username: user.username, account: user.account, nickname: user.nickname, role: 'user', status: user.status || (user.is_active ? 'active' : 'disabled'), isActive: Boolean(user.is_active) } });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/me
// 普通首页加载时用它确认是否已经登录。
userAuthRouter.get('/me', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.account, u.nickname, u.status, u.is_active,
              c.name AS class_name,
              COALESCE(a.nickname, a.username, a.account, '') AS teacher_name
       FROM users u
       LEFT JOIN teaching_classes c ON c.id = u.class_id
       LEFT JOIN admins a ON a.id = c.teacher_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    const user = result.rows[0];

    if (!user) {
      res.status(401).json({ message: '请先登录学员账号' });
      return;
    }

    res.json({
      data: {
        id: user.id,
        username: user.username,
        account: user.account,
        nickname: user.nickname,
        role: 'user',
        status: user.status || (user.is_active ? 'active' : 'disabled'),
        isActive: Boolean(user.is_active),
        className: user.class_name || '',
        teacherName: user.teacher_name || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/user/logout
// 清除学员 Cookie。
userAuthRouter.post('/logout', (req, res) => {
  clearUserCookie(res);
  res.json({ message: '已退出登录' });
});

// GET /api/user/assignments/today
// 学员首页作业：只展示最新一次作业推送 operation 的整批内容。
// 不按自然日过滤；有些学员可能两天交一次作业，上一批作业在老师重新布置前应继续显示。
userAuthRouter.get('/assignments/today', requireUser, async (req, res, next) => {
  try {
    const latestOperationResult = await pool.query(
      `SELECT operation_id, MAX(created_at) AS created_at
       FROM user_assignments
       WHERE user_id = $1
         AND is_deleted = FALSE
       GROUP BY operation_id
       ORDER BY MAX(created_at) DESC
       LIMIT 1`,
      [req.user.userId]
    );

    const latestOperation = latestOperationResult.rows[0];

    if (!latestOperation) {
      res.json({ data: { assignmentDate: null, operationId: null, assignments: [] } });
      return;
    }

    const assignmentsResult = await pool.query(
      `SELECT ua.id, ua.operation_id, ua.message, ua.created_at,
         COALESCE(NULLIF(ua.practice_requirement, ''), CASE WHEN ua.object_type = 'message' THEN ua.message ELSE '' END) AS practice_requirement,
         COALESCE(ua.submit_requirement, '') AS submit_requirement,
         COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) AS object_type,
         COALESCE(ua.object_id, ua.video_id) AS object_id,
         ua.part_id,
         ${assignmentTitleExpression()} AS title,
         ${assignmentCoverExpression()} AS cover_url,
         v.description AS video_description,
         ${assignmentNavigationExpression()} AS navigation_url,
         COALESCE(a.nickname, a.username, a.account, '老师') AS teacher_name
       FROM user_assignments ua
       ${assignmentJoins()}
       WHERE ua.user_id = $1
         AND ua.operation_id = $2
         AND ua.is_deleted = FALSE
         AND ${liveAssignmentFilter()}
       ORDER BY ua.created_at ASC, ua.id ASC`,
      [req.user.userId, latestOperation.operation_id]
    );

    const assignments = assignmentsResult.rows;
    const assignmentDate = latestOperation.created_at || assignments[0]?.created_at || null;

    res.json({
      data: {
        assignmentDate,
        operationId: latestOperation.operation_id,
        assignments
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/assignments/history
// 学员历史作业：按 operation 聚合，使用推送时固化的标题快照，纯浏览不可点击。
userAuthRouter.get('/assignments/history', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `WITH ops AS (
         SELECT operation_id, MAX(created_at) AS created_at
         FROM user_assignments
         WHERE user_id = $1 AND is_deleted = FALSE
         GROUP BY operation_id
       ), op_items AS (
         SELECT ua.operation_id,
           COALESCE(json_agg(json_build_object(
             'id', ua.id,
             'object_type', COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END),
             'title', ${assignmentSnapshotTitleExpression()}
           ) ORDER BY ua.created_at ASC) FILTER (WHERE COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) <> 'message'), '[]'::json) AS items
         FROM user_assignments ua
         ${assignmentJoins()}
         WHERE ua.user_id = $1 AND ua.is_deleted = FALSE
         GROUP BY ua.operation_id
       ), op_requirements AS (
         SELECT operation_id,
           COALESCE(NULLIF(MAX(practice_requirement), ''), MAX(message) FILTER (WHERE object_type = 'message'), '') AS practice_requirement,
           COALESCE(NULLIF(MAX(submit_requirement), ''), '') AS submit_requirement
         FROM user_assignments
         WHERE user_id = $1 AND is_deleted = FALSE
         GROUP BY operation_id
       ), op_teachers AS (
         SELECT ua.operation_id, COALESCE(MAX(a.nickname), MAX(a.username), MAX(a.account), '老师') AS teacher_name
         FROM user_assignments ua
         LEFT JOIN admins a ON a.id = ua.assigned_by_admin_id
         WHERE ua.user_id = $1 AND ua.is_deleted = FALSE
         GROUP BY ua.operation_id
       )
       SELECT ops.operation_id, ops.created_at, COALESCE(op_items.items, '[]'::json) AS items,
              COALESCE(op_requirements.practice_requirement, '') AS practice_requirement,
              COALESCE(op_requirements.submit_requirement, '') AS submit_requirement,
              COALESCE(op_teachers.teacher_name, '老师') AS teacher_name
       FROM ops
       LEFT JOIN op_items ON op_items.operation_id = ops.operation_id
       LEFT JOIN op_requirements ON op_requirements.operation_id = ops.operation_id
       LEFT JOIN op_teachers ON op_teachers.operation_id = ops.operation_id
       ORDER BY ops.created_at DESC`,
      [req.user.userId]
    );

    res.json({ data: { operations: result.rows } });
  } catch (error) {
    next(error);
  }
});

