import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from './config.js';

// AWS S3、阿里云 OSS、腾讯云 COS、MinIO 都属于“对象存储”的思路。
// 这里使用 AWS SDK，是因为 MinIO 兼容 S3 协议，学习成本低，后续换云厂商也比较容易理解。
const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

// 上传文件到存储桶，并返回浏览器可访问的 URL。
export async function uploadToBucket({ key, body, contentType }) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

  return `${config.s3.publicBaseUrl}/${key}`;
}

// 从存储桶里删除一个对象。
export async function deleteFromBucket(key) {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key
    })
  );
}

// 列出存储桶里指定前缀下的对象 key。
// 清理孤儿文件脚本会用它对比“数据库记录”和“存储桶真实文件”。
export async function listBucketKeys(prefix) {
  const keys = [];
  let continuationToken;

  do {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    for (const item of result.Contents || []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

// 数据库里保存的是完整 URL，删除对象时需要还原成存储桶里的 key。
export function getKeyFromPublicUrl(url) {
  return url.replace(`${config.s3.publicBaseUrl}/`, '');
}
