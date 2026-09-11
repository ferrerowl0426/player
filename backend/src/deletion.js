import { pool } from './db.js';
import { deleteFromBucket } from './storage.js';

export async function logDeletion(client, { objectType, objectId, objectTitle = '', adminId = null }) {
  await client.query(
    `INSERT INTO deletion_logs (object_type, object_id, object_title, admin_id)
     VALUES ($1, $2, $3, $4)`,
    [objectType, objectId, objectTitle, adminId]
  );
}

export async function clearObjectReferences(client, { objectType, objectId }) {
  await client.query(
    `DELETE FROM prerequisites
     WHERE (object_type = $1 AND object_id = $2)
        OR (prerequisite_type = $1 AND prerequisite_id = $2)`,
    [objectType, objectId]
  );

  const attachments = await client.query(
    `DELETE FROM content_attachments
     WHERE object_type = $1 AND object_id = $2
     RETURNING file_key`,
    [objectType, objectId]
  );

  await client.query(
    `DELETE FROM library_resource_links
     WHERE object_type = $1 AND object_id = $2`,
    [objectType, objectId]
  );

  await Promise.all(attachments.rows.map((row) => row.file_key).filter(Boolean).map((key) => deleteFromBucket(key).catch(() => {})));
}

export async function deleteWithReferences(client, { objectType, objectId, objectTitle = '', adminId = null }) {
  await clearObjectReferences(client, { objectType, objectId });
  await logDeletion(client, { objectType, objectId, objectTitle, adminId });
}

export async function logStandaloneDeletion({ objectType, objectId, objectTitle = '', adminId = null }) {
  await pool.query(
    `INSERT INTO deletion_logs (object_type, object_id, object_title, admin_id)
     VALUES ($1, $2, $3, $4)`,
    [objectType, objectId, objectTitle, adminId]
  );
}
