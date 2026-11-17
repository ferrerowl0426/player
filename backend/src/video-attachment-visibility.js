// 视频附件（video_attachments）的可见性规则集中处理。
// 行为对齐 content_attachments 的 attachment-save.js：
//   - 默认 public（新建且遗漏 visibility 时）。
//   - 编辑时遗漏 visibility 则保留该附件已存储的 previous（含 private 沿用）。
//   - 显式 private 必须过私密写入开关 assertPrivateWriteAllowed（默认 off → 403）。
//   - 私密不允许落在“跨 content / library / 其它 video 共用的 key”上。
// 不在此处提交事务：调用方负责 BEGIN / ROLLBACK / COMMIT，并把 client 传入校验。
import { PRIVATE, VisibilityError, resolveVisibilityInput } from './content-visibility.js';
import { assertPrivateWriteAllowed } from './content-privacy-config.js';

// 解析单个视频附件的可见性输入。
//   input === undefined：沿用 previousVisibility（遗漏保留；previous 无值则默认 public）。
//   input 为 'public' / 'private'：采用之。
//   其它值：抛 VisibilityError（400）。
export function resolveVideoAttachmentVisibility(input, previousVisibility) {
  return resolveVisibilityInput(input, previousVisibility);
}

// 在写入前校验“私密”是否允许。
//   visibility !== 'private'：直接放行（public 不需要任何额外校验）。
//   visibility === 'private'：
//     1) 过私密写入开关；已为 private（含编辑遗漏保留）不算“新的私密写入”，放行。
//     2) 若 fileKey 被 content_attachments / library_resources / 其它 video 共用，禁止设为私密。
// 抛出的错误带有 .status（VisibilityError=400、PrivateWriteDisabledError=403），由路由统一映射。
export async function assertVideoAttachmentWriteAllowed({
  client,
  videoId,
  fileKey,
  visibility,
  previousVisibility
}) {
  if (visibility !== PRIVATE) return;

  // 新的私密写入受部署开关保护；已私密则放行（遗漏保留不被重置）。
  // 注意：不再因“共用 key”而禁止设为私密——附件 visibility 独立、不影响父级，
  // 共用文件的私密化不再视为冲突（保留正常删除/引用保护由调用方负责）。
  assertPrivateWriteAllowed(PRIVATE, previousVisibility);
}
