import { Router } from 'express';
import { pool } from './db.js';
import { optionalContentViewer } from './auth.js';
import { createDownloadUrl } from './storage.js';
import { authorizeAttachment } from './attachment-access.js';

export const attachmentsRouter = Router();

// 处理附件下载预签名地址的授权与签发。GET 返回短期有效的预签名 URL，HEAD 仅用于探测
// 存在性/权限（与 GET 走同一套鉴权，不引入独立签名），无响应体。
// 私密下载地址绝不缓存：学生/游客看到 404，授权者看到短期有效的签名 URL，二者都不能被
// 代理或浏览器缓存，避免私密 URL 通过共享缓存泄露。
async function handleDownloadUrl(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.vary('Cookie');

  let row;
  try {
    row = await authorizeAttachment(pool, {
      id: Number(req.params.id), source: req.query.source || 'content', viewer: req.contentViewer
    });
  } catch {
    return res.status(503).json({ message: '附件授权服务暂不可用' });
  }

  // 统一 404：不区分“存在但无权”与“不存在”，避免泄露私密附件的存在性（fail-closed）。
  if (!row) {
    res.status(404).json({ message: '附件不存在或无权访问' });
    return;
  }

  try {
    const url = await createDownloadUrl({ key: row.file_key, expiresIn: 300 });
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.json({ data: { id: row.id, url, expiresIn: 300 } });
  } catch {
    // 签名（预签名 URL 生成）失败：返回通用错误，不向上层传播底层存储错误或文件存在性。
    res.status(500).json({ message: '下载地址生成失败' });
  }
}

attachmentsRouter.get('/:id/download-url', optionalContentViewer, handleDownloadUrl);
attachmentsRouter.head('/:id/download-url', optionalContentViewer, handleDownloadUrl);
