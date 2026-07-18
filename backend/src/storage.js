import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

// AWS S3、阿里云 OSS、腾讯云 COS、MinIO 都属于“对象存储”的思路。
// 这里使用 AWS SDK，是因为腾讯云 COS 兼容 S3 协议，学习成本低，后续换云厂商也比较容易理解。
const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

// 预签名 URL 是给浏览器直传用的。本地 Docker + MinIO 时，后端访问地址是 minio:9000，
// 但浏览器访问地址是 localhost:9000，所以签名时允许使用单独的公开 endpoint。
// 生产环境腾讯云 COS 一般不需要配置 S3_PUBLIC_ENDPOINT，会直接复用 S3_ENDPOINT。
const presignClient = new S3Client({
  endpoint: config.s3.publicEndpoint || config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

export function getPublicUrl(key) {
  return `${config.s3.publicBaseUrl}/${key}`;
}

// 生成一个短时间有效的 PUT 上传地址。
// 浏览器拿到这个地址后，可以直接把小文件上传到对象存储，不再经过后端中转。
export async function createUploadUrl({ key, contentType }) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(presignClient, command, { expiresIn: 10 * 60 });
}

// 创建腾讯云 COS Multipart Upload。
// 这个接口只创建“分片上传任务”，不会上传文件内容；真正的每个分片仍由浏览器直传 COS。
export async function createMultipartUpload({ key, contentType }) {
  const result = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.s3.bucket,
      Key: key,
      ContentType: contentType
    })
  );

  return result.UploadId;
}

// 给某一个分片生成预签名上传地址。
// partNumber 从 1 开始，前端用这个 URL PUT 对应 Blob 分片到 COS。
export async function createMultipartPartUrl({ key, uploadId, partNumber }) {
  const command = new UploadPartCommand({
    Bucket: config.s3.bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber
  });

  return getSignedUrl(presignClient, command, { expiresIn: 10 * 60 });
}

// 所有分片上传完成后，调用 Complete 让 COS 合并成最终对象。
// parts 必须包含每片上传后返回的 ETag 和对应 PartNumber。
export async function completeMultipartUpload({ key, uploadId, parts }) {
  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.s3.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber
        }))
      }
    })
  );
}

// 上传中途失败或用户取消时，必须 Abort，避免 COS 里残留未完成的分片任务。
export async function abortMultipartUpload({ key, uploadId }) {
  await s3Client.send(
    new AbortMultipartUploadCommand({
      Bucket: config.s3.bucket,
      Key: key,
      UploadId: uploadId
    })
  );
}

export async function ensureObjectExists(key) {
  await s3Client.send(
    new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: key
    })
  );
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
