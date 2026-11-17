import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearUserCookie, getUserCookieOptions, requireUser, signUserToken } from './auth.js';
import { loadAssignmentNavigation } from './assignment-navigation.js';
import { changeOwnPassword, changePasswordRateLimiter, changePasswordRateLimitKey } from './password-service.js';
import {
  assignmentTargetJoins,
  assignmentTargetPrivateExpr,
  assignmentSnapshotTitleExpr,
  assignmentTargetProjection
} from './assignment-targets.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
}

// 当前显示 / 存在性 / 公开资格一律复用共享解析层，不再手写漂移的 video CASE。
// 历史快照标题单独投影，读取/改名/调序/隐私切换都不改快照列。

// 历史接口专用：布置时标题快照（缺失固定文案，不用当前名称伪造旧标题）。
function assignmentSnapshotTitleExpression() {
  return assignmentSnapshotTitleExpr();
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
      `SELECT id, username, account, nickname, password_hash, status, is_active, auth_version
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

// POST /api/user/change-password
// 学员本人改密；成功后清空登录 Cookie，旧 token 因 auth_version 递增立即失效。
userAuthRouter.post('/change-password', requireUser, async (req, res, next) => {
  try {
    if (typeof req.body?.oldPassword !== 'string' || typeof req.body?.newPassword !== 'string') {
      return res.status(400).json({ code: 'INVALID_PASSWORD_INPUT', message: '旧密码和新密码必须为文本' });
    }
    const { oldPassword, newPassword } = req.body;

    const limitKey = changePasswordRateLimitKey('user', req.ip, req.user.userId);
    if (!changePasswordRateLimiter.allow(limitKey)) {
      res.status(429).json({ message: '操作过于频繁，请稍后再试' });
      return;
    }

    const result = await changeOwnPassword({
      pool,
      table: 'users',
      id: req.user.userId,
      oldPassword,
      newPassword
    });

    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }

    clearUserCookie(res);
    res.json({ message: '密码修改成功，请重新登录' });
  } catch (error) {
    next(error);
  }
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
       ORDER BY MAX(created_at) DESC, operation_id DESC
       LIMIT 1`,
      [req.user.userId]
    );

    const latestOperation = latestOperationResult.rows[0];

    if (!latestOperation) {
      res.json({ data: { assignmentDate: null, operationId: null, assignments: [] } });
      return;
    }

    // 删除/私密目标不再通过 liveAssignmentFilter 丢弃整行：同一批次的行全部保留、
    // 保持原排序；目标状态由共享投影实时推导，private/missing 返回统一灰框 DTO。
    // message 行只承载要求，不渲染资源卡（前端按 object_type 处理），此处仍保留字段兼容。
    const assignmentsResult = await pool.query(
      `SELECT ua.id, ua.operation_id, ua.message, ua.created_at,
         COALESCE(NULLIF(ua.practice_requirement, ''), CASE WHEN ua.object_type = 'message' THEN ua.message ELSE '' END) AS practice_requirement,
         COALESCE(ua.submit_requirement, '') AS submit_requirement,
         COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) AS object_type,
         COALESCE(ua.object_id, ua.video_id) AS object_id,
         ua.part_id,
         ${assignmentTargetProjection().join(',\n         ')},
         COALESCE(a.nickname, a.username, a.account, '老师') AS teacher_name
       FROM user_assignments ua
       ${assignmentTargetJoins()}
       WHERE ua.user_id = $1
         AND ua.operation_id = $2
         AND ua.is_deleted = FALSE
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
             'title', ${assignmentSnapshotTitleExpression()},
             'target_private', ${assignmentTargetPrivateExpr()}
           ) ORDER BY ua.created_at ASC) FILTER (WHERE COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) <> 'message'), '[]'::json) AS items
         FROM user_assignments ua
         ${assignmentTargetJoins()}
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

// GET /api/user/assignments/:id/navigation
// 单个作业点击导航状态（available / private / missing），供 Web 端点击复核。
// 仅当 available 才下发真实导航地址与目标；private / missing 一律脱敏（不泄露私密标题/封面/链接）。
// 归属非本人、已删除、目标已删除 -> missing（绝不暴露为 private，防止越权探测）；
// 目标存在但对学生不可公开可见 -> private；目标公开可见 -> available。
// 网络 / 数据库异常与 private 严格区分：异常由全局错误处理返回 500，不伪装成 private。
userAuthRouter.get('/assignments/:id/navigation', requireUser, async (req, res, next) => {
  try {
    const navigation = await loadAssignmentNavigation(pool, req.params.id, { userId: req.user.userId });
    res.json({ data: { id: String(req.params.id), ...navigation } });
  } catch (error) {
    next(error);
  }
});

