# PRD — 能学慧吉他教室 · 小程序端学生功能（当前实现口径）

> 版本：v1.0（按 2026-11-18 当前产品与实现状态同步，取代旧首版开发计划）
> 日期：2026-11-18
> 范围：微信小程序**学生端**；网页端仍为老师 / 教导主任办公端。
> 本文权威口径来源：当前代码（`miniprogram/`、`backend/src/miniprogram.*.js`、`assignment-targets.js`、`assignment-navigation.js`、`password-service.js`）+ [根目录 README §12/§18/§19](../README.md) + [backend/README §6](../backend/README.md) + [README-miniprogram](../README-miniprogram.md)。历史 PRD / 阶段计划若与当前实现冲突，以当前实现和用户确认结论为准，不恢复旧方案。

---

## 0. 本次同步说明（先读）

本文把 2026-10-03 的旧首版 PRD（含从零 M0–M8 时间计划）整体重写为**当前产品需求与实现说明**，变更要点：

- 移除“所有媒体必须走 STS + 私有桶”的旧强制方案及从零 M0–M8 开发计划。后端实际仍保留 `POST /api/miniprogram/files/sts` 与 `miniprogram.sts.js` 兼容能力；不能把它们写成不存在或本轮已删除。当前学生前端主流程使用普通视频源和文件 signed-url，不强制引入 COS SDK/STS。
- 文件访问改为：`GET /files/:fileId/signed-url?source=library|attachment`（保留后端鉴权，未知 `source` 返回 400）；视频播放走 CDN `playUrl` 优先、同档 COS 原 URL 回退。
- 补齐当前已实现能力：本人改密、稳定作业关联与静默失效灰框、导航复核、8 项关键业务契约。
- **本次仅文档同步**：不操作服务器 / 数据库、不上传小程序。服务器已完成健康检查与两项迁移，不等同于真机或浏览器全量验收；小程序前端是否已上传发布待用户确认。

---

## 1. 背景与产品定位

网页端已覆盖曲目区、知识点区、图书馆、学生首页、历史作业，但以桌面办公为主。小程序把固定学生的查看能力移动化：在微信里看作业、播放课程、打开资料、回看历史。

定位：**面向固定学生的学习记录与课程查看工具**。

边界：

1. 只做学生端：查看课程、作业、资料、历史；不提供老师 / 教导主任移动后台。
2. 不做公众注册：学生账号由**教导主任**在 Web 端创建，初始密码固定 `Nxh123456`，可暂不分班（`class_id=null`）；普通老师不创建学生账号，也不得替他人重置密码。
3. 不做微信 openid / unionid 绑定、绑定码、邀请码、解绑流程。
4. 不做交易、支付、会员、广告、社区、作业上传提交。
5. 复用现有后端、数据库、COS / CDN；不新增微信绑定表。

---

## 2. 角色、账号与登录

| 角色 | 使用小程序 | 说明 |
|---|---:|---|
| 学生（user） | 是 | 查看今日作业、课程、图书馆 PDF、历史、本人改密 |
| 老师 | 否 | Web 端布置作业、管理本班学生 |
| 教导主任 | 否 | Web 端创建 / 重置学员账号、管理内容与班级 |
| 游客 | 否 | 小程序不开放公众演示 / 注册 |

### 2.1 登录口径

- 表单字段：学生账号 + 密码。登录字段 `account` 兼容 `username`；后端按 `account = $1 OR username = $1` 查询。
- **学生 `username` 是登录账号，不是昵称**；展示用昵称取 `nickname`，`account` 为兼容别名。
- 后端：`POST /api/miniprogram/login`。账号不存在返回 `404 STUDENT_NOT_FOUND`「无法识别该学生，请联系老师确认账号」；密码错误返回 `401 INVALID_CREDENTIALS`「账号或密码错误，请联系老师确认账号」。前端另拦截非学生角色账号。
- 不做微信手机号授权、不新增 `openid` / `bind_code` / `invite_code` 等字段。
- 会话：Bearer token，有效期 **15 天**（`expiresIn=1296000`），本地缓存 `studentToken` / `student` / `studentTokenExpiresAt`；退出 / 401 / 改密成功均清理会话及业务缓存（`homeworkTodayCache`、`homeworkHistoryCache`、`coursesCache`、`libraryCache`、`studentMeCache`）。
- 鉴权：`requireMiniStudent` 校验 Bearer、学生身份、`auth_version` 与账号状态；改密 / 管理重置会递增 `auth_version`，所有旧会话（含其他设备）随后鉴权失效，须重新登录。

### 2.2 停用账号行为（与旧文档存在差异，待产品确认）

当前实现（`miniprogram.auth.js` / `miniprogram.routes.js`）的真实行为：

- `/login` **不校验账号状态**：密码正确即签发 token 并返回登录成功。
- 之后所有需鉴权接口经 `requireMiniStudent`：若状态不是 `active`，返回 **`403 ACCOUNT_DISABLED`「该账号已停用，无法使用小程序」**并清 cookie。
- 因此停用账号拿得到登录响应，但无法读取任何业务数据；首页 / 课程 / 图书馆 / 历史 / 我的均依赖鉴权接口，实际不可用。
- 我的页代码保留停用提示条「账号已停用：如需继续学习请联系老师。」，但停用账号在接口层已被拒绝，通常无法正常使用该页面。

> 旧 PRD 写「停用学生允许进入，仍可浏览课程、资料和历史」，与当前实现冲突。本 PRD 按实现据实描述，**不把旧需求写成已实现**。是否改为「停用只读可浏览」属未确认需求，见 §11 差异清单。

---

## 3. 信息架构

底部 Tab 固定 **5 个**（以 `app.json` 与 README-miniprogram 为准）：

| Tab | 页面 | 说明 |
|---|---|---|
| 首页 | `pages/home/index` | 最新作业、练习 / 提交要求、学习入口、失效占位 |
| 课程 | `pages/courses/index` | 四分区课程浏览与搜索 |
| 图书馆 | `pages/library/index` | PDF 列表与打开 |
| 历史 | `pages/history/index` | 历史作业只读快照 |
| 我的 | `pages/mine/index` | 学生信息、本人改密、退出 |

非 Tab 页面：登录、曲目 / 知识点详情、曲谱集 / 知识点集详情、音频播放。详情页不使用底部 Tab，用顶部返回。

全局状态：轻量 loading；网络失败「加载失败，请稍后重试」；各列表有空态；未登录经 `requireLogin()` 跳登录页；403 按接口错误提示，不自动跳转。审核边界：不出现注册、老师 / 教导主任后台、交易 / 支付 / 广告 / 社区入口。

---

## 4. 页面级功能需求与验收

### 4.1 学生登录页

**目标**：固定学生用 Web 已创建账号进入；不提供注册、绑定、找回密码、邀请码入口。

**结构 / 规则**：账号 + 密码输入；登录成功 `switchTab` 到首页；已有有效会话再次进入直接进首页；退出清除会话回登录页；错误提示见 §2.1，不泄露数据库 / 系统错误；明确展示「此账号不是学生账号」的拦截。

**验收**：账号密码可登录；无注册 / 绑定 / 邀请码入口；非学生账号被拒；已登录保持会话；退出回登录页。

### 4.2 首页（最新作业）

**目标**：进入即看到班级、最新一次作业、练习 / 提交要求，并能进入课程 / 历史。

**作业读取口径（关键）**：

- 后端 `getTodayHomework` 先取**最新未删除批次**的 `operation_id`（按 `MAX(created_at)`、`operation_id` 倒序 `LIMIT 1`），再读取该批次**整批全部行**，不用固定行数在 JS 里猜批次。
- `message` 行只承载练习 / 提交要求，不渲染为资源卡、不占 1~5 项额度；要求从整批聚合。
- 标题 / 封面 / P 序号 / 父 ID 使用**当前内容表实时投影**：改名、换封面、移动 P 后立即反映当前值。

**作业卡片状态**：

| 状态 | 行为 |
|---|---|
| `available` | 展示当前标题、封面、P 标识与动作文案；点击走导航复核 |
| `private` / `missing` | 原位保留灰框，标题精确为 **「此资料已经被老师更改」**；无封面、无 P 标识、无「进入详情」、无 `target`；点击**完全无响应**：不发请求、不 Toast、不弹窗、不跳转 |

**点击复核规则**：

- 原可用卡点击调用 `GET /api/miniprogram/homework/:id/navigation` 实时复核；仅 `status=available` 且带有效 `target` 才跳转。
- 后端复核以真实目标为准：归属非本人 / 已删除 / 目标已删除 → `missing`；目标存在但对学生不可公开可见 → `private`（脱敏，不下发真实标题 / 封面 / URL）；恢复公开后实时变回 `available`。
- 无 `assignment.id` 一律按 `missing` 失效返回，不用列表旧 `target` 旁路跳转；复核下发的 `target.partId` 优先于旧 `partId`。
- 页面用 `active` / `loadVersion`，导航传 `isCurrent`：页面隐藏 / 卸载后的过期响应一律静默丢弃，不更新 UI、不提示、不跳转；竞态失效只把该卡原位变灰。
- `onShow()` 每次重新查询，恢复公开后下一次查询自动恢复，不永久缓存失效状态。

**验收**：最新批次完整展示；改名 / 换封面 / 移动 P 反映当前；private / missing 灰框文案精确且点击静默；可用卡点击经复核；无 id 不旁路；过期响应不跳走；`onShow` 恢复公开；长文本折叠不影响整页滚动。

### 4.3 课程页（四分区）

**四分区**（默认 `knowledge-set`）：`knowledge-set`（知识点集）、`track-set`（曲目集）、`knowledge`（知识点）、`track`（曲目）。前端映射：知识类走 `/knowledge`，曲目类走 `/tracks`；`type` 取 `knowledge_collection` / `track_collection` / `knowledge_point` / `track_point`。

**规则**：标题 / 关键词搜索（后端按名称匹配）；排序支持时间倒序 / 时间正序 / 按标题，默认时间倒序；双列卡片；下拉刷新；切分区清空关键词并回到顶部。学生只看公开可见内容（后端过滤，前端隐藏不是安全边界）。

**验收**：默认 knowledge-set 分区；四分区可切换；搜索与排序生效；卡片进入对应详情；无横向滚动。

### 4.4 曲目 / 知识点详情页

**结构**：视频播放器、课程信息、P 列表、附件资料、关联图书馆资料、前置学习。

**播放与清晰度**：

- 清晰度档位来自 `renditions`（`source` / `720p` / `1080p`），默认优先 `720p`，其次 `source`，再取第一档；无多档时只显示原画。
- 播放地址 `videoUrl` 优先取 CDN `playUrl`，否则回退同档 COS 源 `originVideoUrl`；播放失败时**仅对当前 P + 当前清晰度 + 当前 CDN 地址回退一次 COS**，保留进度、倍速、播放意图，避免循环回退。不再使用视频 TypeA 短签。
- 切换清晰度记录当前时间与播放状态，换源后按原进度恢复；暂停态切换不因 `active=true` 误播。
- `onHide` / `onUnload` 暂停播放器并清定时器；每次换源带独立 `sourceToken`，旧异步回调不得自动续播。
- 倍速档位：`0.5 / 0.8 / 1 / 1.25 / 1.5 / 2`（视频播放器）。全屏、进度拖动、上一 P / 下一 P 可用。

**P 与资料**：分 P 进入时定位到对应 P（结构用真实 `part_id`）；关联图书馆资料为「直接关联 + 所属合集继承」的并集且去重；附件只展示公开附件，独立分流 PDF / 图片 / MP3；前置学习仅展示对学生可见的内容。

**验收**：视频可播放、P 可切换；默认 720p/source；切清晰度保留进度；离页暂停且旧回调不自动播放；CDN 失败同档 COS 回退；附件与关联资料可打开或有明确失败提示；前置可进入对应详情。

### 4.5 曲谱集 / 知识点集详情页

展示封面、名称、简介、成员数量与列表；成员仅含对学生可见的公开课程；点击成员进入单曲 / 知识点详情；合集可见性由成员派生（至少一个可见成员才可见）；合集资料展示规则同详情页。

**验收**：两类集合复用同一结构；成员可进入详情；无可见成员的整体不可见；简介长文本可展开。

### 4.6 图书馆页

**当前口径**：图书馆列表**只展示 PDF**（前端对接口结果按 `fileType === 'PDF'` 过滤）；支持标题搜索、下拉刷新；点击 PDF 走 `services/files.js` 打开流程。

**验收**：PDF 列表与搜索可用；打开失败有明确提示；空态 / 加载失败态完整。MP3 / 图片附件走课程详情，不在图书馆列表展示。

### 4.7 音频播放页

**入口**：MP3 附件 / 资料由 `services/files.js` 分流进入（带 `fileId` / `fileSource` / 标题 / 来源）。

**规则**：通过 `GET /files/:fileId/signed-url?source=...` 取地址（要求 HTTPS）；播放 / 暂停、拖动进度、循环、倍速可选 **0.5 / 0.75 / 1**；快进步长**动态 5–30 秒**（时长 ≤30s 取 5s，≤90s 取 10s，更长取时长 8% 并夹在 15–30s）；iOS 倍速 / seek 后补写播放速率；离页 `stop` + `destroy`，不自动续播。

**验收**：MP3 可进入并播放；倍速为 0.5 / 0.75 / 1；快进步长动态 5–30s；拖动进度可用；加载 / 格式 / 网络错误提示清晰。

### 4.8 历史作业页

**当前口径**：**全部为布置时标题快照，只读**。后端 `serializeAssignment(..., 'history')` 只读 `assigned_object_title` / `assigned_video_title`，不套失效文案、不输出任何导航 `target`；前端 `normalizeAssignment(..., { snapshot: true })` 与今日状态分开。

**规则**：按 `operation_id` 聚合、时间倒序；每条展示布置时间 / 星期 / 老师 / 内容标题快照 / 练习要求 / 提交要求；已删除作业保留「已删除 · 原因」说明。标题**无任何点击跳转、无 Toast、无弹窗**；支持按老师 / 标题 / 练习要求 / 提交要求搜索；无历史显示空态。

**验收**：历史为只读标题快照；改名 / 私密 / 删除都不改成失效文案；无任何跳转或 Toast；搜索与空态正常。

### 4.9 我的页

**信息**：头像首字、昵称、班级、账号状态、身份说明；界面文案「资料修改请联系老师」。

**本人改密（已实现）**：入口「重置密码 → 修改本人密码」。流程：

- `POST /api/miniprogram/change-password`，请求体 `oldPassword` / `newPassword`。
- 新密码长度 5–30、不得与原密码相同；前端行内校验。
- **旧密码错误返回 400 `OLD_PASSWORD_INCORRECT`**，行内提示「原密码不正确，请重新输入」，**不按 401 退出登录**（避免误触自动清会话）。
- 成功：提示「密码修改成功，请重新登录」，清理会话与业务缓存，`reLaunch` 登录页；后端原子递增 `auth_version`，所有旧会话失效。
- 接口另有 60 秒最多 10 次的内存限流；401 分支（会话过期）清会话并跳登录。停用账号不显示改密入口。

**退出**：`confirmLogout` 弹窗确认 → 调 `/logout` → 无论结果都 `clearSession` → 回登录页。

**验收**：昵称 / 班级 / 状态正确；改密成功清会话重登录；旧密错为 400 且不退出；退出可用；不提供资料自助修改入口。

---

## 5. 作业与可见性契约（禁止回退）

- **稳定身份**：作业绑定 `object_type + object_id`，P 用真实 `part_id`（兼容旧数据 `COALESCE(part_id, object_id)`）；P 序号与播放 URL **不是**身份。改名、换封面、移动 P 后同一作业显示当前值。实现见 `backend/src/assignment-targets.js` 与 `miniprogram.services.js`。
- **公开派生**：P 公开派生课程公开，课程公开派生合集公开；附件独立（有独立 `visibility`，不参与派生）；**图书馆无私密字段**。学生 / 游客只看公开；老师 / 主任可看私密但私密内容不可作为作业目标。
- **失效占位**：private / missing 原位灰框，精确标题「此资料已经被老师更改」，无封面 / target，点击静默（无请求 / Toast / 弹窗 / 跳转）。
- **复核与恢复**：可用卡点击走 `GET /homework/:id/navigation`；恢复公开后下一次查询自动恢复；最新批次按稳定 ID 完整读取；整批失效仍保留最新批次练习 / 提交要求，不回退旧批次。
- **历史**：只读标题快照，不作跳转入口，不因目标改名 / 私密 / 删除改成失效文案。
- **Web 对应**：Web focus / visibilitychange 与小程序 `onShow` 同样做失效恢复，可用卡点击同样做导航复核。详见根 README §12、§19 与 backend README §6。

---

## 6. 接口清单（相对 `/api/miniprogram`）

| 接口 | 用途 |
|---|---|
| `POST /login` | 账号密码登录，签发 15 天 Bearer |
| `POST /logout` | 清服务端 cookie（前端同时清本地会话） |
| `POST /change-password` | 本人改密，`oldPassword` / `newPassword`，旧密错 400 |
| `GET /me` | 当前学生信息 |
| `GET /homework/today` | 最新未删批次完整整批作业 |
| `GET /homework/history?page=1&pageSize=20` | 历史作业快照，按 `operation_id` 分页聚合 |
| `GET /homework/:id/navigation` | 单作业点击复核：`available` / `private` / `missing` |
| `GET /tracks`、`GET /tracks/:id`、`GET /tracks/collections/:id` | 曲目与曲谱集 |
| `GET /knowledge`、`GET /knowledge/:id`、`GET /knowledge/collections/:id` | 知识点与知识点集 |
| `GET /library`、`GET /library/:id` | 图书馆 PDF 列表与详情 |
| `GET /files/:fileId/signed-url?source=library\|attachment` | 文件签名地址，保留后端鉴权；`source` 仅 `library` / `attachment`，未知返回 `400 INVALID_SOURCE` |

安全要求：个性化接口一律从当前会话识别学生，不接受请求体传 `user_id` 查他人数据；写操作（改密等）必须后端鉴权，前端隐藏入口不算安全；不在端上保存永久密钥。**旧“强制 STS 私有桶”主方案不再适用；后端 `POST /files/sts` 兼容端点仍存在，但不是当前学生前端主流程；视频不依赖短签，附件 / 图书馆下载仍走上述签名 URL。**

---

## 7. 媒体、文件访问与已知边界

- 数据库保存 COS 源地址；响应保留 `videoUrl` / `originVideoUrl`（COS）并新增 `playUrl`（CDN，默认 `media.nxhguitar.com`，源 `gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com`）。转换仅针对精确源域名，带签名参数或其他域名不盲目改写。
- 播放优先 CDN，失败回退**同一视频、同一清晰度**的 COS，保留进度 / 播放状态，避免循环回退。**视频 TypeA 短签及 `MEDIA_CDN_AUTH_*` 启动强校验已移除**，不要再引入。
- **不强制私有桶**：业务私密不等于文件级保密。已知公开直链、转发、缓存、已下载文件**不可追回**，不承诺撤回 / 加密；不把业务隐藏描述为文件加密。
- 附件 / 图书馆的 `signed-url` 仍保留后端鉴权；`attachment` 入口额外校验父课程非私密，防止私密父课程附件被旁路签名。
- `services/files.js` 分流：MP3 → 音频页；JPG / PNG → `previewImage`；PDF / Office → `downloadFile` + `openDocument`；其他类型提示前往 Web 端下载。小程序**不新增 P 视频下载入口**。

---

## 8. 环境与发布

| 用途 | 地址 |
|---|---|
| 正式小程序 API | `https://api.nxhguitar.com/api/miniprogram` |
| 本机后端 API / 健康检查 | `http://localhost:3000/api/miniprogram`、`http://localhost:3000/api/health` |
| 本机 Web（非 API 代理） | `http://localhost:3001` |

- 默认连线上。API 基址两处配置必须一致：`miniprogram/app.js` 的 `globalData.apiBaseUrl` 与 `miniprogram/utils/constants.js` 的 `API_BASE_URL`；页面只拼相对路径。
- **真机不能用 localhost**（指向手机），改用电脑局域网 IP，如 `http://<电脑局域网IP>:3000/api/miniprogram`，需网络互通与防火墙允许；切换环境后清会话 / 业务缓存再登录。本地 MinIO 地址也须手机可达。
- 微信合法域名：request 含正式 API；downloadFile / 媒体按实际请求包含 **CDN、COS 及文件下载返回域名**。开发者工具「不校验合法域名」仅开发有效，体验版 / 正式版须 HTTPS 有效证书与可达地址。
- **独立微信上传发布，非 Docker**：Docker 只更新后端 / Web，不会自动发布小程序。发布前两处 API 配置恢复线上 HTTPS，检查无本地 IP / 调试账号 / 密钥 / 错误 AppID；开发者工具编译、体验版真机验收通过后，用已授权 AppID 上传版本并在公众平台提交审核 / 发布，记录版本号、Git 提交与后端版本。前端是否已上传发布待用户确认。
- 服务器部署：Compose 依次加载 `docker-compose.yml` → `docker-compose.local.yml` → `docker-compose.production.yml`，**production 最后覆盖 local 的 development**。首次升级须备份 → 隔离副本演练 → 显式执行八表 visibility（`migrate-content-visibility.js --apply`）与 `auth_version`（`migrate-auth-version.js --apply`）两项迁移 → 再重建服务；缺字段会触发 schema 门禁 502。完整命令、备份与回滚见根 README §3.2 与 backend README，**本文不重复任何危险命令**（禁止 `docker compose down -v`、reset / seed、清空桶、导入本地 dump 替代生产迁移）。

---

## 9. 合规与过审准备

> 以下为微信小程序常规上线准备，**具体要求以微信公众平台当时规则与主体资质为准，不保证过审，不新造权威政策表述**。

**上线前准备**：小程序账号与主体认证、备案、名称 / 头像 / 简介、服务类目、HTTPS 域名、request / downloadFile / 媒体合法域名、用户隐私保护指引、审核测试账号。

**建议表述**（据实描述，非承诺）：

> 本小程序为教学辅助性质的学习记录工具，仅供老师 / 教导主任已知的固定学生查看课程内容、作业要求、资料和历史学习记录。不开放公众注册，不提供广告服务，不涉及线上交易、支付、会员充值、课程售卖、论坛社区或新闻资讯。

**类目**：选最贴近的「工具 / 教育辅助 / 学习记录」方向，避免写成「在线教育平台」「课程售卖平台」；如选教育培训相关可能涉及主体 / 资质要求，最终以后台可选类目与主体为准。

**隐私信息**：账号（登录身份识别）、会话 token（保持登录）、昵称（展示）、班级（学习归属）、作业记录（展示要求）。不调用微信手机号授权，不采集位置 / 通讯录 / 相册等无关权限，不做画像与广告跟踪，隐私指引中说明数据仅用于学习记录展示。

**审核账号**：准备正常学生、有历史记录学生、停用学生（停用行为见 §2.2，备注据实说明）等测试账号；备注写明「不开放公众注册，仅供已创建固定学生体验首页作业、课程播放、资料查看、历史记录等功能」。

**提审前检查清单**：

- [ ] 首页体现核心功能，非空白页。
- [ ] 无购买 / 支付 / 会员 / 充值 / 报名缴费 / 广告 / 诱导分享 / 注册入口。
- [ ] 无老师 / 教导主任后台入口。
- [ ] 测试账号可进入；视频可播放；PDF 可打开或有明确提示。
- [ ] 隐私保护指引覆盖实际使用的信息；域名 HTTPS / 备案 / 合法域名已配置。
- [ ] 页面内容与所选类目一致。

**常见驳回风险**：类目与功能不一致、需登录未给测试账号、隐私接口未声明、文件 / 视频打不开（合法域名 / CDN / COS / 证书 / 缓存）、出现交易或广告文案、功能过于简单。风险规避以据实配置和真机验证为准，不以本地 MinIO / 关闭域名校验的通过冒充线上验收。

---

## 10. 验收范围

**学生主流程**：登录 → 首页最新作业 → 可用卡点击复核 → 进入课程详情定位并播放 P → 清晰度切换 / CDN 回退 → 附件 PDF / 音频打开 → 历史只读快照 → 我的改密后重新登录 → 退出。

**管理端联动**：老师布置 1~5 个内容 → 首页按最新批次展示；重复推送同一内容不受历史影响；目标改名 / 换封面 / 移动 P → 首页反映当前；目标删除或改私密 → 原位灰框且点击静默；恢复公开 → 下次查询恢复；历史快照不变；教导主任新建学员初始 `Nxh123456` 可暂不分班。

**边界说明**：后端健康检查与集成测试（历史 34 项改密 HTTP 检查、51 项小程序相关测试）均为历史结果，非本次文档更新重新执行；浏览器 / 开发者工具 / 真机交互由用户验收。

---

## 11. 风险与待确认差异

### 11.1 未确认差异（不要假装已实现）

1. **停用账号行为**：旧 PRD 的「停用可登录且可浏览课程 / 资料 / 历史」与当前实现（登录放行、鉴权接口 403、无法读取业务数据）冲突。是否恢复「停用只读」待产品确认；本文按当前实现记载。
2. **小程序前端是否发布**：服务器迁移与健康检查已完成，不代表小程序前端已上传、也不代表真机验收通过，发布状态待用户确认。
3. **云端策略未独立核验**：CDN / COS / 桶策略需以控制台实际配置为准；本地 MinIO 成功不能证明线上 CDN 命中或回退可用。不擅自私有化整桶或声称已完成云端配置。
4. **历史技术债**：课程归一化 mock 兜底、`library-detail` 占位路径、文件下载错误提示中的开发工具文案，不得当作正式接口字段。新增「下载当前分 P」按钮是否走 CDN 尚未实施 / 待确认。

### 11.2 真机与技术风险

- iPhone 静音键、`InnerAudioContext` 倍速 / seek 后补写、`wx.downloadFile` / `openDocument` 的 Content-Type 与 Range、HTTPS 证书需真机验证。
- iOS 原生视频层、横竖屏 / 安全区、拖动手势与退出全屏兜底必须保留；关闭域名校验不能替代正式配置。
- 业务私密不作文件级保密承诺：直链 / 转发 / 已下载内容不可追回。
- React / Next.js 页面、CSS Module、cookie 登录不可直接复用到小程序；小程序通过 HTTPS 接口调用后端，不直接访问数据库。

---

## 12. 参考文档

- [根目录 README](../README.md)：§3.2 服务器三文件覆盖与两项迁移、§12 作业推送规则、§18 CDN / COS 交接、§19 轻量业务可见性。
- [backend/README](../backend/README.md)：§6 密码与作业契约、媒体 / 测试边界。
- [README-miniprogram](../README-miniprogram.md)：小程序地址、会话改密、作业契约、上传发布流程。
- 代码：`backend/src/miniprogram.auth.js`、`miniprogram.routes.js`、`miniprogram.services.js`、`assignment-targets.js`、`assignment-navigation.js`、`password-service.js`；`miniprogram/app.js`、`utils/constants.js`、`utils/format.js`、`utils/navigate.js`、`utils/create-video-detail-page.js`、`services/*`。
