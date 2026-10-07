import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';
import { clearUserCookie } from './auth.js';

export function sendMiniSuccess(res, data = {}, message = 'ok') {
  res.json({ success: true, data, message });
}

export function sendMiniError(res, status, code, message) {
  res.status(status).json({
    success: false,
    error: { code, message }
  });
}

export async function loadStudentById(userId) {
  const numericId = Number(userId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const result = await pool.query(
    `SELECT u.id,
            u.username,
            u.account,
            u.nickname,
            u.status,
            u.is_active,
            u.class_id,
            c.name AS class_name
       FROM users u
       LEFT JOIN teaching_classes c ON c.id = u.class_id
      WHERE u.id = $1`,
    [numericId]
  );

  return result.rows[0] || null;
}

export function serializeStudent(row) {
  if (!row) {
    return null;
  }

  const status = row.status || (row.is_active ? 'active' : 'disabled');
  return {
    id: String(row.id),
    username: row.username || '',
    account: row.account || row.username || '',
    nickname: row.nickname || row.username || row.account || '',
    status,
    isActive: status === 'active' && row.is_active !== false,
    classId: row.class_id ? String(row.class_id) : '',
    className: row.class_name || ''
  };
}

function readBearerToken(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function readStudentToken(req) {
  return readBearerToken(req) || req.cookies?.[config.auth.userCookieName] || '';
}

export async function requireMiniStudent(req, res, next) {
  const token = readStudentToken(req);

  if (!token) {
    sendMiniError(res, 401, 'UNAUTHORIZED', '请先登录');
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret);
  } catch {
    clearUserCookie(res);
    sendMiniError(res, 401, 'UNAUTHORIZED', '登录已过期，请重新登录');
    return;
  }

  if (payload.type !== 'user') {
    sendMiniError(res, 401, 'UNAUTHORIZED', '学生登录状态无效');
    return;
  }

  try {
    const student = await loadStudentById(payload.userId);
    if (!student) {
      clearUserCookie(res);
      sendMiniError(res, 401, 'UNAUTHORIZED', '登录已过期，请重新登录');
      return;
    }

    req.student = serializeStudent(student);
    next();
  } catch (error) {
    next(error);
  }
}
