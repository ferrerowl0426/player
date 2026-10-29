# 后端媒体鉴权与播放地址说明

本项目为“吉他教学”业务（nxhguitar）的媒体分发后端。本文档说明视频/转码播放地址的
生成策略、私密内容可达性，以及腾讯云 CDN TypeA 鉴权（可选）的上线注意事项。

> **重要声明**：本仓库仅实现“应用侧”的播放地址与签名逻辑。**云端鉴权（腾讯云 CDN 控制台
> 开启 TypeA、配置 key 与有效期，以及 COS 私有读 + CDN 私有回源）属于独立的云端配置，
> 本仓库不宣称已为你完成这些云端配置。** 任何 `MEDIA_CDN_*` 开关都不会在控制台侧自动生效。

## 1. 播放地址的两类来源

- **公开对象**（父课程 public 且对应分 P public）：下发**永久**公开地址 `video_url`（COS 源）
  以及兼容式新增的 `play_url`（CDN 播放地址）。前端可逐步从 `video_url` 切换到 `play_url`。
- **私密对象**（私密分 P，或任一宿主私密的共享视频）：不再下发任何永久可播放地址。
  后端只返回 `video_id` 与 `visibility: 'private'`，前端携带身份 Cookie 访问
  `GET /api/playback/videos/:id/play-url` 按需获取**短期**签名 URL。`VideoPlayer` 已支持
  `requiresAuthorization + videoId`，并对带 `sign` 查询参数的短签做 `isSignedUrl` 检测，
  以阻止“签名 CDN 回退到裸 COS”的泄露路径。

详见 `src/playback-access.js`、`src/playback.routes.js`、`src/playback-url.js`。

## 2. 私密内容可达性（fail-closed）

- 学生/游客访问私密视频：统一返回 **404**，不暴露内容存在性。
- 共享视频（同一视频被多个分 P 共用）：**任一宿主私密即视为私密**（fail-closed）。
  非授权查看者拿不到任何永久播放地址，教师/主任也走授权端点（由 `/playback` 端点按角色放行）。
- 相关判断集中在 `content-object-access.js` 与 `playback-access.js#filterPubliclyReadableVideos`，
  列表场景（tracks / knowledge / 小程序）复用同一口径批量判定。

## 3. 腾讯云 CDN TypeA 签名（可选，默认关闭）

仅当 `MEDIA_CDN_AUTH_ENABLED=true` 时，后端对**可信 CDN 域名**的播放地址追加 TypeA 签名参数：

```
sign = timestamp-rand-0-md5(uri-timestamp-rand-0-key)
```

- `timestamp`：运行时 `Date.now()` 生成的 Unix 秒级时间戳（不硬编码）。
- `rand`：`crypto.randomInt` 生成的随机非负整数（不硬编码）。
- `key`：`MEDIA_CDN_AUTH_KEY`（6-40 位字母数字）。
- `uid`：固定 `0`。
- **有效期由腾讯云 CDN 控制台的“鉴权有效期”决定**，应用侧仅通过 `MEDIA_CDN_AUTH_TTL_SECONDS`
  提示前端/业务侧该值，**TTL 不进入 hash**，必须与控制台配置**完全一致**。

### 上线前必读（缺一不可）

1. **云端 TypeA sign 有效期必须匹配**：`MEDIA_CDN_AUTH_TTL_SECONDS` 必须与 CDN 控制台
   “鉴权有效期”相同。否则：有效期设短了，签名在到达客户端前就已过期；设长了，短签长期有效。
2. **COS 私有读 + CDN 私有回源**：要让签名真正保护内容，需在 COS 侧开启私有读，并让 CDN
   走“私有回源”（回源带鉴权/授权），否则 CDN 仍可回源拉到裸文件。这属于云端配置，本仓库不管。
3. **不要对整个桶盲目私有**：桶级私有读会导致封面（`covers/`）、PDF/附件（`attachments/`
   `library/`）等本应公开的对象一并失效。请采用**分前缀策略**：仅对 `tracks/`、`knowledge/`、旧 `videos/`、`transcoded/`
   等媒体前缀私有化或加签，公开资源保持原样。迁移后必须做**验收**（抽查封面、PDF、视频
   在浏览器是否按预期可达/需授权）。
4. **旧链接缓存须刷新**：已签发的旧短签、CDN 边缘缓存、前端已缓存的 `play_url` 在切换鉴权
   策略后可能仍按旧规则命中。上线后按需刷新 CDN 缓存与前端缓存，避免 403/ stale 播放。
5. **短签可转发且有效期内可用**：`/playback/videos/:id/play-url` 返回的短期 URL 在有效期内
   可被转发给他人使用（这是签名 URL 的固有特性），不要据此当作“不可分享”的强管控手段；
   如需更紧的管控，应结合登录态与更短的过期时间。

### 启动期 fail-fast

`MEDIA_CDN_AUTH_ENABLED=true` 但 `MEDIA_CDN_AUTH_KEY` 缺失或不符合 6-40 位字母数字，
或服务启动时校验 `MEDIA_CDN_AUTH_TTL_SECONDS` 非法，都会在 `db.js#ensureAppSchema` 阶段
**直接启动失败**（fail-fast），不会出现“开关开了却静默不生效”的情况。

### 默认不启用、不生成真实密钥

- `MEDIA_CDN_AUTH_ENABLED` 默认 `false`（COS 私有读短签仍是默认播放路径）。
- 本仓库任何代码都不会自动生成或写入真实密钥；真实 key 由部署方在环境变量中提供。

## 4. 环境变量（见 `.env.example`）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `MEDIA_CDN_ENABLED` | 是否把 COS 源地址转换为 CDN 播放地址（与签名无关） | `true` |
| `MEDIA_CDN_AUTH_ENABLED` | 是否追加 CDN TypeA 签名 | `false` |
| `MEDIA_CDN_AUTH_KEY` | TypeA 鉴权 key（6-40 位字母数字），开启时必填 | 空 |
| `MEDIA_CDN_AUTH_TTL_SECONDS` | 应用侧提示的有效期（秒），须与控制台一致 | `300` |
| `MEDIA_CDN_TRUSTED_DOMAINS` | 追加可信 CDN 域名（逗号分隔），仅这些域名会被签名 | 默认含 `media.nxhguitar.com` |

根目录与 `backend/` 各有一份 `.env.example`，均含上述占位配置与 business 说明。

## 5. 测试

```
node --experimental-test-module-mocks --test src/playback-url.test.js \
  src/playback-access.test.js src/playback.routes.test.js \
  src/playback.routes.cdn.test.js src/content-playback-visibility.test.js \
  src/videos-visibility.test.js
```

覆盖：TypeA 签名算法与配置校验、共享视频 fail-closed 判定、play-url 端点 CDN 短签优先、
tracks/knowledge 私密 P 清空与共享宿主 fail-closed、videos 关联 OR→every 的 fail-closed。
