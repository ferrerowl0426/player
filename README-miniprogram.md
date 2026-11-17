# 能学慧吉他教室 · 微信小程序交接 README

> 面向接手学生端的程序员。Web/服务器总览见 [README.md](README.md)，后端迁移与媒体排障见 [backend/README.md](backend/README.md)。旧需求文档可能保留历史 Toast、待实施改密、TypeA 短签方案，当前规则以本文与对应代码为准。

## 1. 范围与入口

- 微信原生小程序，代码 `miniprogram/`；仅学生端，不新增老师后台、注册、支付、广告、会员或 openid 绑定。
- 功能：账号登录、今日作业、课程/合集、分 P 播放、附件、图书馆 PDF、历史记录、我的/本人改密。
- 老师、教导主任在 Web 管理；内容公开/私密开关不放到学生端。
- API 命名空间 `/api/miniprogram`，与 Web 共用 Express 后端、PostgreSQL 和存储。

## 2. 地址、端口与本地联调

| 用途 | 地址 |
|---|---|
| 正式小程序 API | `https://api.nxhguitar.com/api/miniprogram` |
| 正式 Web | `https://nxhguitar.com` |
| 本机 Web | `http://localhost:3001` |
| 本机后端健康检查 | `http://localhost:3000/api/health` |
| 本机小程序 API | `http://localhost:3000/api/miniprogram` |

小程序**默认连接线上 API**，本地重建 Docker 不会自动切换它。统一配置位置：

- `miniprogram/app.js` 的 `globalData.apiBaseUrl`（主配置）。
- `miniprogram/utils/constants.js` 的 `API_BASE_URL`（回退配置）。

本地开发可临时把上述两处改为本地 API；页面服务只拼相对路径，不再各自硬编码域名。发布前两处恢复 HTTPS 线上地址，避免上传本地配置。

### 联调步骤

1. 按根 README 启动本地后端，确认 3000 健康检查成功；3001 是网页，不是 API 代理。
2. 在微信开发者工具导入项目，项目配置/小程序根目录指向实际 `miniprogram/`，使用已授权的 AppID，不在文档中存放密钥。
3. 模拟器本机联调可以用 localhost；临时关闭域名/证书校验仅用于开发，不是上线解决方案。
4. **真机不能用 localhost**（它指向手机）。使用电脑局域网 IP，例如 `http://<电脑局域网IP>:3000/api/miniprogram`，确保手机与电脑网络互通、服务监听可达、防火墙允许；本地 MinIO 返回地址也必须能被手机访问。
5. 若真机环境不允许本地 HTTP/域名调试，使用受控 HTTPS 测试环境及相应合法域名配置；不要修改生产权限来绕过限制。
6. 切换环境后退出并清除旧会话/业务缓存再登录，避免拿线上 token 访问本地或反之。

## 3. 页面与共享层

页面注册以 `miniprogram/app.json` 为准，底部 Tab 固定：**首页 / 课程 / 图书馆 / 历史 / 我的**。

| 页面 | 路径 | 职责 |
|---|---|---|
| 登录 | `pages/login/index` | 学生账号密码登录 |
| 首页 | `pages/home/index` | 当前作业、学习入口、失效占位 |
| 课程 | `pages/courses/index` | 曲目、曲谱集、知识点、知识点集 |
| 图书馆 | `pages/library/index` | PDF 列表与打开 |
| 历史 | `pages/history/index` | 布置快照只读浏览/搜索 |
| 我的 | `pages/mine/index` | 学生信息、本人改密、退出 |
| 曲目/知识点 | `pages/track-detail/index`、`pages/knowledge-detail/index` | 分 P、视频、附件、前置 |
| 合集 | `pages/track-collection/index`、`pages/knowledge-collection/index` | 合集成员课程 |
| 文件承载 | `pages/library-detail/index` | 文件详情/预览承载 |
| 音频 | `pages/audio-player/index` | 附件音频播放 |

关键共享文件：

- `services/request.js`：统一请求，Base URL、Bearer、15 秒超时、401 清理会话、错误归一化。
- `services/auth.js`：登录/退出/学生资料/改密、缓存和 `requireLogin()`。
- `services/homework.js`、`courses.js`、`library.js`、`files.js`：相应业务 API。
- `utils/format.js`：驼峰/下划线兼容、作业状态/历史快照、课程与图书馆归一化。
- `utils/navigate.js`：作业 ID 导航复核、目标页面与 P 定位，不允许旧 target 绕过复核。
- `utils/create-video-detail-page.js`：两类视频详情共享播放器、生命周期与 CDN 回退。

新增页面注册到 app.json，接口走统一请求层，不为小程序随意破坏 Web 既有接口。

## 4. 会话与本人改密

- 默认 token 有效期 15 天；启动从缓存恢复 token/student，不等于已完成服务器权限复核。
- 缓存键：studentToken、student、studentTokenExpiresAt。业务缓存包括 homeworkTodayCache、homeworkHistoryCache、coursesCache、libraryCache、studentMeCache。
- `requireLogin()` 同时检查 student/token，缺失清理并 reLaunch 登录页。
- 退出先尝试服务端 logout，无论结果都执行本地 clearSession，清理会话及业务缓存。
- “我的”**已实现本人改密**：旧密码、新密码及各自密码可见按钮。旧密码错误行内提示，不能当成会话过期退出。
- 改密成功提示后清理会话并重新登录；后端递增 auth_version，旧设备 Cookie/Bearer 随后鉴权失效。
- 旧密码错误使用 400，不使用会触发 request.js 自动清理的 401。
- 新建学员由 Web 管理端创建，初始密码固定 `Nxh123456`，可暂不分班；旧账号密码不自动重置。
- 小程序只允许学生本人改密，不提供管理重置入口。

## 5. 作业稳定关联与失效恢复（禁止回到旧 Toast 方案）

### 稳定身份

作业关联 object_type + object_id，分 P 使用真实 part_id，不是 P2/P3 序号，也不是播放 URL。移动 P、改名、换封面后，同一作业显示**当前**标题、封面和 P 序号。

### 今日作业

- 后端 target_status / targetStatus 区分 available、private、missing。
- private/missing 保留原位置灰框；标题精确为 **“此资料已经被老师更改”**；清空图片、P 标识和导航 target，不显示“进入详情”。
- 已知失效卡片点击**完全无响应**：不请求导航、不 Toast、不弹窗、不跳转。
- available 点击调用 `GET /homework/:id/navigation` 实时复核，仅 available + 有效 target 导航；刚变失效则原位变灰、静默处理。
- 无 assignment.id 一律按 missing 处理，不能用列表旧 target 旁路跳转。
- 服务端返回的 target.partId 优先于旧 assignment.partId。
- `onShow()` 重新查询；恢复公开后下一次查询自动恢复，不永久缓存失效。
- home 使用 active/loadVersion；导航传 isCurrent，页面隐藏/卸载后的旧响应不能更新 UI、提示或跳转。
- 今日作业按最新批次完整读取，不能用固定若干行猜批次；message 是历史兼容，不当资料卡。

### 历史记录与老师回填

- 历史保留布置时标题快照，即使目标改名/私密/删除也不改成失效标题；条目只读，无点击导航、无私密 Toast。
- `normalizeAssignment(..., { snapshot: true })` 与今日状态投影分开，不能混用。
- 老师回填在 Web 实施，后端 latest 接口按稳定 ID 返回当前可用目标；失效过滤、恢复公开可恢复回填；整批失效仍保留最新批次练习/提交要求。

## 6. 课程权限、CDN 与文件

### 可见性

后端负责过滤学生无权记录，前端隐藏不是安全边界。公开 P 派生课程公开、公开课程派生合集公开；附件独立私密，不参与派生；图书馆无私密。私密前置对学生隐藏，已有前置/作业不阻止老师把目标改私密。

### 播放地址

- 数据库存 COS 源；授权可见项响应保留 videoUrl/originVideoUrl，playUrl 提供 CDN 地址。
- 默认源 `gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com`，CDN `media.nxhguitar.com`；转换仅针对精确源域名，签名 URL/其他源不盲目改写。
- 优先 CDN，失败回退**相同视频、相同清晰度** COS，保留位置和播放状态，避免循环重试。
- 视频 TypeA 短签已移除，正常播放不依赖兼容 play-url 授权端点。不要重新加回旧 MEDIA_CDN_AUTH 配置或把视频 URL 清空后强制短签。
- **业务私密不等于文件级保密**：已知公开直链、转发、缓存及已下载文件可能继续访问，不承诺撤回/加密。
- 附件、图书馆的 signed-url 文件接口仍保留，不能把“移除视频 TypeA”误解为所有文件都不签名。

### 视频与文件实现约束

两类详情共享 create-video-detail-page；自定义控制条支持播放、进度、清晰度、倍速、全屏。默认清晰度优先 720p，再 source；Web 默认偏好可能不同，不要为统一文案误改行为。横竖屏/安全区、iOS 原生视频层、拖动手势与退出全屏兜底必须保留。onHide/onUnload 暂停并清理定时器，旧异步回调不得自动续播。

`services/files.js` 统一分流 MP3 到音频页、图片到 previewImage、PDF 到 downloadFile/openDocument。音频离页 stop/destroy；iPhone 静音键、Content-Type、Range 和 HTTPS 需真机验证。小程序不新增 P 视频下载入口。

### 微信合法域名与云端排障

- request 合法域名包含正式 API；downloadFile 及媒体相关域名按实际请求包含 CDN、COS 和文件下载返回域名。以微信控制台当时可配置的类别和实际网络请求核对，不能只配 API。
- 开发者工具“不校验合法域名”只对开发有效，体验版/正式版仍须合法域名、HTTPS、有效证书及可达地址。
- CDN 失败先对比 COS 同档是否正常：COS 也失败查 key/权限/转码；COS 正常而 CDN 失败查域名证书、回源、防盗链、残留 TypeA 和负缓存。
- 本地 MinIO 成功不能证明真实 CDN 已验收。云端策略要独立核验，不擅自私有化全桶或声称已完成 CDN 控制台配置。

## 7. 后端接口与部署协作

相对 `/api/miniprogram`：login、logout、me、homework/today、homework/history、homework/:id/navigation、tracks、knowledge、两类课程/合集详情、library、files/:fileId/signed-url。具体 HTTP 方法及改密路径以 services/auth.js 和后端路由为准，新增接口同步文档。

后端服务器 `/root/player`，Compose 项目 `video_player`。发布必须依次加载：

```text
docker-compose.yml
docker-compose.local.yml
docker-compose.production.yml
```

production 文件在服务器创建、必须最后加载，覆盖 local 的 development 为 production；不可只修改根 .env 就认为生效。完整命令、备份与回滚见根 README 第 3.2 节。

首次升级当前后端须备份、隔离副本演练并显式执行八表 visibility / auth_version 迁移，再启动；缺字段会触发 schema 门禁而 502。普通小程序前端更新不需要新建数据库、seed 或清空存量数据。

最近服务器已完成提交 24c9c32 的两项迁移、生产覆盖与健康检查；不代表小程序前端已上传，也不代表真机已验收。

## 8. 小程序上传发布（与 Docker 分开）

1. 确认后端已部署且 schema、HTTPS API 健康；核对接口兼容性。
2. 两处 API 配置恢复线上 HTTPS 地址，检查变更中无本地 IP、调试账号密码、密钥或错误 AppID。
3. 微信开发者工具编译、预览；用户自行做体验版/真机验收，特别是登录、改密、失效灰框、公开恢复、P 重排定位、历史快照、视频回退及 PDF。
4. 通过已授权 AppID 上传版本，填写版本号和变更说明；在微信公众平台设置体验版、提交审核并发布，按平台流程操作。
5. Docker 只更新后端/Web，**不会自动发布小程序**；本地工具编译成功也不等于正式用户已收到新版本。
6. 记录发布版本、对应 Git 提交和后端版本；回滚小程序与回滚后端分别处理，保持接口兼容。

## 9. 协作与验证边界

- 视觉保持深棕、白色/浅棕格纹、低饱和；长标题省略，复用现有控件；不恢复旧“资料”Tab。
- 修改 format/navigate/播放器共享层必须检查所有调用页与相应测试。
- 历史测试结果：相关小程序测试 51 项通过，不是本次文档更新重新执行；浏览器/开发工具/真机交互由用户验收。
- 已知需继续核对的技术债：课程归一化 mock 兜底、library-detail 占位路径、文件下载错误提示中的开发工具文案；不得把旧假数据文案当作正式接口字段。
- 本次仅文档更新，不操作服务器/数据库、不上传小程序。
