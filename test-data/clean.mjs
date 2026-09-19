// 清除 seed.mjs 生成的全部测试数据：
//   1. 按 manifest.json 里的精确 id 删除数据库记录（不碰你手工创建的其他数据）
//   2. 删除对象存储里 test-data/ 前缀的文件
//   3. 兼容旧 manifest：如历史版本曾修改系统账号，则按快照还原；最后删除 manifest.json
// 用法：node clean.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { config } from '../backend/src/config.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Pool } = require('pg');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, 'manifest.json');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.log('没有 manifest.json，测试数据不存在，无需清理。');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const pool = new Pool({ connectionString: config.databaseUrl });
const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

async function q(sql, params = []) {
  await pool.query(sql, params);
}

async function deleteByIds(table, ids) {
  if (!ids?.length) return;
  await q(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
  console.log(`  ${table}: 删除 ${ids.length} 行`);
}

async function main() {
  console.log('== 1/3 删除数据库记录（按 manifest 精确匹配） ==');
  await deleteByIds('user_assignments', manifest.ids.user_assignments);
  for (const p of manifest.prerequisites || []) {
    await q(`DELETE FROM prerequisites WHERE object_type = $1 AND object_id = $2 AND prerequisite_type = $3 AND prerequisite_id = $4`, [p.object_type, p.object_id, p.prerequisite_type, p.prerequisite_id]);
  }
  await deleteByIds('content_attachments', manifest.ids.content_attachments);
  await deleteByIds('deletion_logs', manifest.ids.deletion_logs);
  await deleteByIds('library_resources', manifest.ids.library_resources);
  await deleteByIds('knowledge_points', manifest.ids.knowledge_points);
  await deleteByIds('knowledge_collections', manifest.ids.knowledge_collections);
  await deleteByIds('track_points', manifest.ids.track_points);
  await deleteByIds('track_collections', manifest.ids.track_collections);
  await deleteByIds('videos', manifest.ids.videos);

  // 先删关联，再删测试班级和测试教职工；所有对象均来自 manifest，不影响手工数据。
  if (manifest.ids.teaching_classes?.length) {
    await q('DELETE FROM teacher_classes WHERE class_id = ANY($1::int[])', [manifest.ids.teaching_classes]);
    await deleteByIds('teaching_classes', manifest.ids.teaching_classes);
  }
  await deleteByIds('users', manifest.ids.users);
  await deleteByIds('admins', manifest.ids.admins);

  console.log('== 2/3 删除对象存储文件 ==');
  for (const key of manifest.uploadedKeys || []) await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  console.log(`  已删除 ${manifest.uploadedKeys?.length || 0} 个对象（test-data/ 前缀）`);

  console.log('== 3/3 兼容旧 manifest 并删除 manifest ==');
  for (const snapshot of manifest.existingAccountSnapshots || []) {
    await q(`UPDATE ${snapshot.table} SET account = $1, nickname = $2, password_hash = $3, role = $4, status = $5 WHERE id = $6`, [snapshot.account, snapshot.nickname, snapshot.password_hash, snapshot.role, snapshot.status, snapshot.id]);
  }
  fs.unlinkSync(MANIFEST_PATH);
  console.log('\n测试数据清除完成 ✔（manifest.json 已删除）');
}

main()
  .catch((error) => {
    console.error('清理脚本执行失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
