import { writeFile } from 'node:fs/promises';
import { pool } from '../src/db.js';
import { deleteFromBucket, getKeyFromPublicUrl, listBucketKeys } from '../src/storage.js';

const shouldDelete = process.argv.includes('--delete');

// 允许扫描 / 清理的前缀白名单。
// 只有列在这里的前缀下的对象才会被纳入孤儿判定（删除前还会再校验一次）。
// 未来即使误改了扫描范围，也不会删到白名单外的对象。
const SCAN_PREFIXES = [
  'videos/',
  'covers/',
  'attachments/',
  'tracks/',
  'knowledge/',
  'library/',
  'transcoded/'
];

function toSet(values) {
  return new Set(values.filter(Boolean));
}

// 收集“数据库里仍被引用”的存储桶 key（公开地址会归一化成 key）。
// ⚠️ 每新增一张存对象 key / 地址的表，都必须同步加进来，否则一旦扫描范围
// 覆盖到该前缀，有效文件会被误判为孤儿并删除。
async function getDatabaseKeys() {
  const result = await pool.query(`
    SELECT video_url AS url FROM videos WHERE video_url <> ''
    UNION ALL
    SELECT cover_url FROM videos WHERE cover_url <> ''
    UNION ALL
    SELECT video_url FROM video_renditions WHERE video_url <> ''
    UNION ALL
    SELECT file_key FROM video_attachments WHERE file_key <> ''
    UNION ALL
    SELECT file_url FROM video_attachments WHERE file_url <> ''
    UNION ALL
    SELECT file_key FROM content_attachments WHERE file_key <> ''
    UNION ALL
    SELECT file_url FROM content_attachments WHERE file_url <> ''
    UNION ALL
    SELECT file_key FROM library_resources WHERE file_key <> ''
    UNION ALL
    SELECT file_url FROM library_resources WHERE file_url <> ''
    UNION ALL
    SELECT cover FROM library_resources WHERE cover <> ''
    UNION ALL
    SELECT cover FROM track_points WHERE cover <> ''
    UNION ALL
    SELECT cover FROM track_collections WHERE cover <> ''
    UNION ALL
    SELECT cover FROM knowledge_points WHERE cover <> ''
    UNION ALL
    SELECT cover FROM knowledge_collections WHERE cover <> ''
  `);

  return toSet(result.rows.map((row) => getKeyFromPublicUrl(row.url)));
}

function groupByPrefix(keys) {
  const groups = new Map();

  for (const key of keys) {
    const prefix = SCAN_PREFIXES.find((item) => key.startsWith(item)) || '(白名单外)';
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix).push(key);
  }

  return groups;
}

async function main() {
  const databaseKeys = await getDatabaseKeys();
  const bucketKeys = [];

  for (const prefix of SCAN_PREFIXES) {
    bucketKeys.push(...(await listBucketKeys(prefix)));
  }

  const orphanKeys = bucketKeys.filter((key) => !databaseKeys.has(key));

  console.log(`数据库引用文件数量：${databaseKeys.size}`);
  console.log(`扫描前缀：${SCAN_PREFIXES.join(', ')}`);
  console.log(`存储桶实际文件数量：${bucketKeys.length}`);
  console.log(`孤儿文件数量：${orphanKeys.length}`);

  if (orphanKeys.length === 0) {
    console.log('没有发现孤儿文件。');
    return;
  }

  console.log('\n孤儿文件列表（按前缀分组）：');
  for (const [prefix, keys] of groupByPrefix(orphanKeys)) {
    console.log(`- ${prefix} 共 ${keys.length} 个`);
    for (const key of keys) {
      console.log(`  · ${key}`);
    }
  }

  // 删除前先把清单落盘留档，便于事后核对。
  const snapshotPath = `storage-orphans-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  await writeFile(snapshotPath, `${orphanKeys.join('\n')}\n`, 'utf8');
  console.log(`\n待删除清单已写入：${snapshotPath}`);

  if (!shouldDelete) {
    console.log('\n当前只是预览，没有删除文件。');
    console.log('确认无误后，可以执行：npm run storage:clean -- --delete');
    return;
  }

  console.log('\n开始删除孤儿文件...');
  for (const key of orphanKeys) {
    // 白名单外的对象一律不删（正常不会被扫到，这里只是最后一道保险）。
    if (!SCAN_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      console.warn(`跳过白名单外的对象：${key}`);
      continue;
    }

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
