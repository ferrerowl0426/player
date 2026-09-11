import { pool, ensureAppSchema } from '../src/db.js';
import { deleteFromBucket, listBucketKeys } from '../src/storage.js';

async function clearDatabase() {
  const tablesResult = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `);

  for (const row of tablesResult.rows) {
    await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
  }
}

async function clearBucket() {
  const keys = await listBucketKeys('');

  for (const key of keys) {
    await deleteFromBucket(key);
  }

  return keys.length;
}

async function main() {
  console.log('开始清空测试数据库...');
  await clearDatabase();
  console.log('测试数据库已清空。');

  console.log('开始清空存储桶...');
  const deletedObjectCount = await clearBucket();
  console.log(`存储桶已清空，删除对象数量：${deletedObjectCount}`);

  console.log('开始按新模型重新初始化基础数据...');
  await ensureAppSchema();
  console.log('基础数据初始化完成。');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
