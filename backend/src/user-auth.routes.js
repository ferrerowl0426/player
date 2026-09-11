import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { clearUserCookie, getUserCookieOptions, requireUser, signUserToken } from './auth.js';

function normalizeLoginText(value) {
  return String(value ?? '').trim();
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
      `SELECT id FROM admins WHERE username = $1`,
      [username]
    );

    if (adminResult.rows.length > 0) {
      res.status(403).json({ message: '没有这个学生' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, password_hash, is_active
       FROM users
       WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];
    const passwordMatched = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!passwordMatched) {
      res.status(401).json({ message: '学员账号或密码错误' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ message: '这个学员已被禁用，请联系老师' });
      return;
    }

    const token = signUserToken(user);
    res.cookie(config.auth.userCookieName, token, getUserCookieOptions());
    res.json({ data: { username: user.username, role: 'user' } });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/me
// 普通首页加载时用它确认是否已经登录。
userAuthRouter.get('/me', requireUser, (req, res) => {
  res.json({
    data: {
      username: req.user.username
    }
  });
});

// POST /api/user/logout
// 清除学员 Cookie。
userAuthRouter.post('/logout', (req, res) => {
  clearUserCookie(res);
  res.json({ message: '已退出登录' });
});

// GET /api/user/assignments/today
// 学员首页的“今日的作业”分成两块：有效视频推送和最新留言。
userAuthRouter.get('/assignments/today', requireUser, async (req, res, next) => {
  try {
    const assignmentsResult = await pool.query(
      `SELECT ua.id, ua.message, ua.created_at,
         COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) AS object_type,
         COALESCE(ua.object_id, ua.video_id) AS object_id,
         ua.part_id,
         COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), v.title, t.name, c.name, kp.name, kpc.name, parent_t.name, parent_kp.name, '') AS title,
         COALESCE(v.cover_url, t.cover, c.cover, kp.cover, kpc.cover, parent_t.cover, parent_kp.cover, '') AS cover_url,
         v.description AS video_description,
         CASE
           WHEN COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'video' THEN '/videos/' || COALESCE(ua.object_id, ua.video_id)
           WHEN ua.object_type = 'track_point' THEN '/tracks/' || ua.object_id
           WHEN ua.object_type = 'track_collection' THEN '/tracks/collections/' || ua.object_id
           WHEN ua.object_type = 'knowledge_point' THEN '/knowledge/' || ua.object_id
           WHEN ua.object_type = 'knowledge_collection' THEN '/knowledge/collections/' || ua.object_id
           WHEN ua.object_type = 'track_part' THEN '/tracks/' || parent_t.id || '?part=' || COALESCE(ua.part_id, ua.object_id)
           WHEN ua.object_type = 'knowledge_part' THEN '/knowledge/' || parent_kp.id || '?part=' || COALESCE(ua.part_id, ua.object_id)
           ELSE NULL
         END AS navigation_url
       FROM user_assignments ua
       LEFT JOIN videos v ON v.id = COALESCE(ua.object_id, ua.video_id) AND COALESCE(ua.object_type, 'video') = 'video'
       LEFT JOIN track_points t ON t.id = ua.object_id AND ua.object_type = 'track_point'
       LEFT JOIN track_collections c ON c.id = ua.object_id AND ua.object_type = 'track_collection'
       LEFT JOIN knowledge_points kp ON kp.id = ua.object_id AND ua.object_type = 'knowledge_point'
       LEFT JOIN knowledge_collections kpc ON kpc.id = ua.object_id AND ua.object_type = 'knowledge_collection'
       LEFT JOIN track_parts tp ON tp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'track_part'
       LEFT JOIN track_points parent_t ON parent_t.id = tp.track_id
       LEFT JOIN knowledge_parts kpp ON kpp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'knowledge_part'
       LEFT JOIN knowledge_points parent_kp ON parent_kp.id = kpp.knowledge_point_id
       WHERE ua.user_id = $1 AND ua.is_deleted = FALSE
         AND (
           COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'message'
           OR (COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'video' AND v.id IS NOT NULL)
           OR (ua.object_type = 'track_point' AND t.id IS NOT NULL)
           OR (ua.object_type = 'track_collection' AND c.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_point' AND kp.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_collection' AND kpc.id IS NOT NULL)
           OR (ua.object_type = 'track_part' AND tp.id IS NOT NULL AND parent_t.id IS NOT NULL)
           OR (ua.object_type = 'knowledge_part' AND kpp.id IS NOT NULL AND parent_kp.id IS NOT NULL)
         )
       ORDER BY ua.created_at DESC`,
      [req.user.userId]
    );

    const assignments = assignmentsResult.rows;
    const assignmentDate = assignments[0]?.created_at || null;

    res.json({
      data: {
        assignmentDate,
        assignments
      }
    });
  } catch (error) {
    next(error);
  }
});

