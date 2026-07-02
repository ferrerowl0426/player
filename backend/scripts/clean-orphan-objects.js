import { pool } from '../src/db.js';
import { deleteFromBucket, getKeyFromPublicUrl, listBucketKeys } from '../src/storage.js';

const shouldDelete = process.argv.includes('--delete');

function toSet(values) {
  return new Set(values.filter(Boolean));
}

async function getDatabaseKeys() {
  const result = await pool.query('SELECT video_url, cover_url FROM videos');
  const keys = [];

  for (const row of result.rows) {
    keys.push(getKeyFromPublicUrl(row.video_url));
    keys.push(getKeyFromPublicUrl(row.cover_url));
  }

  return toSet(keys);
}

async function main() {
  const databaseKeys = await getDatabaseKeys();
  const bucketKeys = [
    ...(await listBucketKeys('videos/')),
    ...(await listBucketKeys('covers/'))
  ];

  const orphanKeys = bucketKeys.filter((key) => !databaseKeys.has(key));

  console.log(`数据库引用文件数量：${databaseKeys.size}`);
  console.log(`存储桶实际文件数量：${bucketKeys.length}`);
  console.log(`孤儿文件数量：${orphanKeys.length}`);

  if (orphanKeys.length === 0) {
    console.log('没有发现孤儿文件。');
    return;
  }

  console.log('\n孤儿文件列表：');
  for (const key of orphanKeys) {
    console.log(`- ${key}`);
  }

  if (!shouldDelete) {
    console.log('\n当前只是预览，没有删除文件。');
    console.log('确认无误后，可以执行：npm run storage:clean -- --delete');
    return;
  }

  console.log('\n开始删除孤儿文件...');
  for (const key of orphanKeys) {
    await deleteFromBucket(key);
    console.log(`已删除：${key}`);
  }

  console.log('孤儿文件清理完成。');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
