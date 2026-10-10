import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { createDownloadUrl } from './storage.js';
import { clearUserCookie, getUserCookieOptions, signUserToken } from './auth.js';

const MINI_TOKEN_EXPIRES_IN_SECONDS = 15 * 24 * 60 * 60;
import { requireMiniStudent, sendMiniError, sendMiniSuccess, serializeStudent } from './miniprogram.auth.js';
import { issueMiniSts } from './miniprogram.sts.js';
import {
  getHomeworkHistory,
  getKnowledgeCollectionDetail,
  getKnowledgeDetail,
  getLibraryDetail,
  getTodayHomework,
  getTrackCollectionDetail,
  getTrackDetail,
  listKnowledge,
  listLibrary,
  listTracks
} from './miniprogram.services.js';

export const miniprogramRouter = Router();

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function getAccountAndPassword(req) {
  return {
    account: String(req.body.account ?? req.body.username ?? '').trim(),
    password: String(req.body.password ?? '')
  };
}

miniprogramRouter.post('/login', asyncHandler(async (req, res) => {
  const { account, password } = getAccountAndPassword(req);

  if (!account || !password) {
    sendMiniError(res, 400, 'VALIDATION_ERROR', '请输入账号和密码');
    return;
  }

  const result = await pool.query(
    `SELECT u.id,
            u.username,
            u.account,
            u.nickname,
            u.password_hash,
            u.status,
            u.is_active,
            u.class_id,
            c.name AS class_name
       FROM users u
       LEFT JOIN teaching_classes c ON c.id = u.class_id
      WHERE u.account = $1 OR u.username = $1
      LIMIT 1`,
    [account]
  );

  const user = result.rows[0];
  if (!user) {
    sendMiniError(res, 404, 'STUDENT_NOT_FOUND', '无法识别该学生，请联系老师确认账号');
    return;
  }

  const passwordMatched = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatched) {
    sendMiniError(res, 401, 'INVALID_CREDENTIALS', '账号或密码错误，请联系老师确认账号');
    return;
  }

  const token = signUserToken(user, { expiresIn: MINI_TOKEN_EXPIRES_IN_SECONDS });
  const expiresAt = Date.now() + MINI_TOKEN_EXPIRES_IN_SECONDS * 1000;
  res.cookie('user_token', token, { ...getUserCookieOptions(), maxAge: MINI_TOKEN_EXPIRES_IN_SECONDS * 1000 });
  sendMiniSuccess(res, { token, expiresAt, expiresIn: MINI_TOKEN_EXPIRES_IN_SECONDS, student: serializeStudent(user) });
}));

miniprogramRouter.post('/logout', (req, res) => {
  clearUserCookie(res);
  sendMiniSuccess(res, {});
});

miniprogramRouter.get('/me', requireMiniStudent, (req, res) => {
  sendMiniSuccess(res, { student: req.student });
});

miniprogramRouter.get('/homework/today', requireMiniStudent, asyncHandler(async (req, res) => {
  sendMiniSuccess(res, await getTodayHomework(req.student));
}));

miniprogramRouter.get('/homework/history', requireMiniStudent, asyncHandler(async (req, res) => {
  sendMiniSuccess(res, await getHomeworkHistory(req.student, req.query));
}));

miniprogramRouter.get('/tracks', requireMiniStudent, asyncHandler(async (req, res) => {
  sendMiniSuccess(res, await listTracks(req.query));
}));

miniprogramRouter.get('/tracks/collections/:id', requireMiniStudent, asyncHandler(async (req, res) => {
  const detail = await getTrackCollectionDetail(req.params.id);
  if (!detail) {
    sendMiniError(res, 404, 'NOT_FOUND', '曲谱集不存在或已删除');
    return;
  }
  sendMiniSuccess(res, detail);
}));

miniprogramRouter.get('/tracks/:id', requireMiniStudent, asyncHandler(async (req, res) => {
  const detail = await getTrackDetail(req.params.id);
  if (!detail) {
    sendMiniError(res, 404, 'NOT_FOUND', '曲目不存在或已删除');
    return;
  }
  sendMiniSuccess(res, detail);
}));

miniprogramRouter.get('/knowledge', requireMiniStudent, asyncHandler(async (req, res) => {
  sendMiniSuccess(res, await listKnowledge(req.query));
}));

miniprogramRouter.get('/knowledge/collections/:id', requireMiniStudent, asyncHandler(async (req, res) => {
  const detail = await getKnowledgeCollectionDetail(req.params.id);
  if (!detail) {
    sendMiniError(res, 404, 'NOT_FOUND', '知识点集不存在或已删除');
    return;
  }
  sendMiniSuccess(res, detail);
}));

miniprogramRouter.get('/knowledge/:id', requireMiniStudent, asyncHandler(async (req, res) => {
  const detail = await getKnowledgeDetail(req.params.id);
  if (!detail) {
    sendMiniError(res, 404, 'NOT_FOUND', '知识点不存在或已删除');
    return;
  }
  sendMiniSuccess(res, detail);
}));

miniprogramRouter.get('/library', requireMiniStudent, asyncHandler(async (req, res) => {
  sendMiniSuccess(res, await listLibrary(req.query));
}));

miniprogramRouter.get('/library/:id', requireMiniStudent, asyncHandler(async (req, res) => {
  const detail = await getLibraryDetail(req.params.id);
  if (!detail) {
    sendMiniError(res, 404, 'NOT_FOUND', '资料不存在或已删除');
    return;
  }
  sendMiniSuccess(res, detail);
}));

miniprogramRouter.post('/files/sts', requireMiniStudent, asyncHandler(async (req, res) => {
  try {
    const data = await issueMiniSts({
      student: req.student,
      ip: req.ip,
      scene: req.body.scene,
      fileIds: Array.isArray(req.body.fileIds) ? req.body.fileIds : [],
      ttlSeconds: req.body.ttlSeconds
    });
    sendMiniSuccess(res, data);
  } catch (error) {
    sendMiniError(res, error.status || 500, error.code || 'STS_ERROR', error.message || '文件凭证签发失败');
  }
}));

miniprogramRouter.get('/files/:fileId/signed-url', requireMiniStudent, asyncHandler(async (req, res) => {
  const source = String(req.query.source || req.query.type || 'library');
  let fileId = req.params.fileId;
  let objectKey = '';

  if (source === 'attachment') {
    const result = await pool.query(
      'SELECT id, file_key, file_url FROM content_attachments WHERE id = $1',
      [fileId]
    );
    const row = result.rows[0];
    objectKey = row?.file_key || '';
    fileId = row?.id ? String(row.id) : fileId;
  } else {
    const detail = await getLibraryDetail(fileId);
    objectKey = detail?.objectKey || '';
    fileId = detail?.id || fileId;
  }

  if (!objectKey) {
    sendMiniError(res, 404, 'NOT_FOUND', '文件不存在或已删除');
    return;
  }

  const url = await createDownloadUrl({ key: objectKey, expiresIn: 10 * 60 });
  sendMiniSuccess(res, {
    fileId,
    source,
    url,
    expiresIn: 600,
    method: 'GET'
  });
}));
