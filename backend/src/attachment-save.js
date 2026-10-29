import { lockCourse, resolveVisibilityInput, VisibilityError } from './content-visibility.js';
import { assertPrivateWriteAllowed } from './content-privacy-config.js';
// Caller supplies storage operations, never accepts a client-provided file URL.
export async function saveContentAttachments({ pool, objectType, objectId, values, ensureObjectExists, getPublicUrl }) {
  if (!Array.isArray(values)) throw new VisibilityError('附件列表必须为数组');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockCourse(client, objectType, objectId);
    const old = (await client.query('SELECT * FROM content_attachments WHERE object_type=$1 AND object_id=$2 FOR UPDATE', [objectType, objectId])).rows;
    const kept = [], keys = new Set();
    for (const [index, input] of values.entries()) {
      if (!input || typeof input !== 'object') throw new VisibilityError('附件参数无效');
      const key = String(input.fileKey ?? input.file_key ?? '');
      const suppliedId = input.id === undefined ? null : Number(input.id);
      const previous = suppliedId === null ? old.find((r) => r.file_key === key) : old.find((r) => r.id === suppliedId);
      if (suppliedId !== null && !previous) throw new VisibilityError('附件ID不属于此课程');
      const actualKey = key || previous?.file_key;
      if (!actualKey || actualKey.includes('..') || keys.has(actualKey)) throw new VisibilityError('附件文件重复或无效');
      keys.add(actualKey);
      if (!previous && !actualKey.startsWith(`attachments/${objectType}/${objectId}/`)) throw new VisibilityError('附件文件不属于此课程');
      if (previous && actualKey !== previous.file_key) throw new VisibilityError('替换文件须作为新附件上传，不可修改已有附件key');
      const visibility = resolveVisibilityInput(input.visibility, previous?.visibility);
      assertPrivateWriteAllowed(visibility, previous?.visibility);
      if (visibility === 'private') {
        const shared = await client.query(`SELECT 1 FROM content_attachments WHERE file_key=$1 AND NOT(object_type=$2 AND object_id=$3)
          UNION ALL SELECT 1 FROM video_attachments WHERE file_key=$1
          UNION ALL SELECT 1 FROM library_resources WHERE file_key=$1 LIMIT 1`, [actualKey, objectType, objectId]);
        if (shared.rows.length) throw new VisibilityError('共用文件不能单独设为私密，请上传独立文件', 'SHARED_ATTACHMENT');
      }
      const name = String(input.fileName ?? input.file_name ?? previous?.file_name ?? '').trim();
      if (!name) throw new VisibilityError('附件名称不能为空');
      const type = String(input.fileType ?? input.file_type ?? previous?.file_type ?? '');
      const size = Number(input.fileSize ?? input.file_size ?? previous?.file_size ?? 0);
      if (!Number.isSafeInteger(size) || size < 0) throw new VisibilityError('附件大小无效');
      await ensureObjectExists(actualKey);
      if (previous) {
        await client.query('UPDATE content_attachments SET file_name=$1,file_type=$2,file_size=$3,sort_order=$4,visibility=$5 WHERE id=$6', [name, type, size, index, visibility, previous.id]);
        kept.push(previous.id);
      } else {
        const created = await client.query(`INSERT INTO content_attachments(object_type,object_id,file_name,file_url,file_key,file_type,file_size,sort_order,visibility)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [objectType, objectId, name, getPublicUrl(actualKey), actualKey, type, size, index, visibility]);
        kept.push(created.rows[0].id);
      }
    }
    await client.query('DELETE FROM content_attachments WHERE object_type=$1 AND object_id=$2 AND NOT(id=ANY($3::int[]))', [objectType, objectId, kept]);
    await client.query('COMMIT');
    // Removed records do not imply unreferenced cloud objects. Cleanup is deferred to audited GC.
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
