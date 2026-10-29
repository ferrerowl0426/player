# 能学慧吉他教室 · 小程序端协作 README

> 本文件面向后续接手微信小程序端的开发者，只记录当前 `miniprogram/` 项目的实际架构、协作约束和注意点。
> 旧版开发计划、阶段任务、提审清单等过程性内容已移除；后续如发现本文档与实际代码不一致，以当前代码为准更新本文档。

---

## 1. 项目定位

这是「能学慧吉他教室」的微信小程序学生端，当前定位是：

- 面向学生使用；
- 主要功能包括登录、首页作业、课程浏览、课程播放、图书馆、历史记录、我的页；
- 老师、教导主任、管理员仍使用网页端后台；
- 小程序不承担后台管理、注册、支付、广告、会员等能力；
- 前端代码位于项目根目录下的 `miniprogram/`；
- 后端接口命名空间统一为 `/api/miniprogram/*`。

当前小程序默认后端地址写在：

```text
miniprogram/app.js
```

实际值为：

```text
https://api.nxhguitar.com/api/miniprogram
```

不要在页面里各自硬编码 API 地址；如需调整环境地址，应优先统一调整全局配置或请求层。

---

## 2. 全局页面架构

页面注册以 `miniprogram/app.json` 为准。

### 2.1 Tab 页面

当前底部 Tab 共 5 个：

| Tab | 页面路径 | 说明 |
|---|---|---|
| 首页 | `pages/home/index` | 学生首页、今日作业、今日用到的课件 |
| 课程 | `pages/courses/index` | 曲目 / 曲目集 / 知识点 / 知识点集入口 |
| 图书馆 | `pages/library/index` | PDF 资料列表、预览、下载 |
| 历史 | `pages/history/index` | 历史作业 / 操作记录聚合展示 |
| 我的 | `pages/mine/index` | 学生信息、账号与退出登录 |

Tab 文案必须保持当前代码中的：

```text
首页 / 课程 / 图书馆 / 历史 / 我的
```

不要再使用旧文档里的“资料”命名。

### 2.2 非 Tab 页面

| 页面 | 页面路径 | 说明 |
|---|---|---|
| 登录页 | `pages/login/index` | 学生账号登录、开发预览入口 |
| 曲目播放详情 | `pages/track-detail/index` | 曲目视频播放、分 P、附件、前置知识点 |
| 曲目合集详情 | `pages/track-collection/index` | 曲目集合内内容列表 |
| 知识点播放详情 | `pages/knowledge-detail/index` | 知识点视频播放、分 P、附件 |
| 知识点合集详情 | `pages/knowledge-collection/index` | 知识点集合内内容列表 |
| 资料详情 / PDF 承载 | `pages/library-detail/index` | 资料预览承载页，PDF 使用微信原生预览 |
| 音频播放页 | `pages/audio-player/index` | 音频附件播放页 |

详情页不属于 Tab 页面，不应强行常驻底部 Tab。

---

## 3. 全局配置与会话

### 3.1 `app.json`

`app.json` 负责：

- 注册页面；
- 配置全局导航栏；
- 配置底部 Tab；
- 指定 tab 图标资源。

当前全局窗口配置：

```text
导航栏标题：能学慧吉他教室
导航栏背景：#ffffff
导航栏文字：black
页面背景：#ffffff
```

Tab 图标位于：

```text
miniprogram/assets/icons/
```

当前使用的图标文件包括：

```text
tab-home.png
tab-home-active.png
tab-course.png
tab-course-active.png
tab-library.png
tab-library-active.png
tab-history.png
tab-history-active.png
tab-mine.png
tab-mine-active.png
```

### 3.2 `app.js`

`app.js` 是全局会话入口，当前 `globalData` 包含：

```js
{
  student: null,
  token: '',
  apiBaseUrl: 'https://api.nxhguitar.com/api/miniprogram'
}
```

启动时：

- `onLaunch()` 从本地缓存恢复 token；
- `onLaunch()` 从本地缓存恢复 student；
- 启动时不会主动请求后端刷新学生资料。

会话写入：

- `setSession({ token, student, expiresAt })` 更新 `globalData`；
- token 和 student 都存在时，写入本地缓存。

会话清理：

- `clearSession()` 清空 `globalData.token`；
- `clearSession()` 清空 `globalData.student`；
- 同时调用服务层清理本地缓存。

会话缓存与接口实现以 `miniprogram/services/auth.js` 为准。当前实际规则：

- token 缓存 key：`studentToken`；
- 学生信息缓存 key：`student`；
- token 过期时间缓存 key：`studentTokenExpiresAt`；
- 默认会话有效期：15 天；
- `requireLogin()` 会同时检查 student 和 token，缺任意一个都会清理本地会话并 `reLaunch` 到 `/pages/login/index`；
- `clearSession()` 不只清登录态，也会清理业务缓存：`homeworkTodayCache`、`homeworkHistoryCache`、`coursesCache`、`libraryCache`、`studentMeCache`；
- 登录接口：`POST /login`；
- 登出接口：`POST /logout`；
- 当前学生信息接口：`GET /me`；
- 登录返回兼容 `data.student || data.user || data`，后端最好稳定返回 `{ token, student, expiresAt }`。

### 3.3 `services/request.js`（统一请求层）

所有接口请求应走 `miniprogram/services/request.js` 的 `request()`，当前实际行为：

- Base URL 取值顺序：`getApp().globalData.apiBaseUrl` → 回退 `utils/constants.js` 的 `API_BASE_URL`；
- 自动附加请求头 `Authorization: Bearer <token>`（token 存在时）；
- `content-type` 默认 `application/json`；
- 2xx 时 resolve `res.data.data ?? res.data`（兼容 `{ code, data }` 包装与裸数据两种返回）；
- 401 时自动清理本地会话缓存（与 `clearSession()` 同一组 key）；
- 网络失败统一抛出「网络连接失败，请稍后重试」，错误对象带 `statusCode` 和 `userMessage` 字段，页面展示错误时优先用 `userMessage`。

新增接口时：在对应服务文件里调 `request()` 拼相对路径即可，不要自己另写 `wx.request`。

### 3.4 `utils/constants.js`（全局常量）

当前维护内容：

- `API_BASE_URL`：`https://api.nxhguitar.com/api/miniprogram`（与 `app.js` 的 `apiBaseUrl` 保持一致，改地址两处要同步）；
- `OBJECT_TYPE_LABELS`：业务对象类型 → 展示文案（`合集 / 单曲 / P / 知识点集 / 知识 / PDF`）；
- `OBJECT_TYPE_ACTIONS`：各对象类型的默认点击行为描述（合集进详情、单曲播 P1、分 P 自动定位播放）。

新增对象类型或改文案时在这里加，不要在页面里写死类型映射。

### 3.5 `utils/format.js`（数据归一化层）

页面不直接消费接口原始字段，而是先经过 `format.js` 归一化。当前导出：

- `formatDateText` / `formatTimeText` / `formatWeekText`：日期 → `M 月 D 日` / `HH:mm` / `周X`；
- `normalizeAssignment`：单条作业归一化，兼容驼峰 / 下划线字段（`objectId || object_id` 等），补齐 `typeLabel`、`partLabel`（`P01` 格式）、`materialMeta`、`materialAction`；
- `normalizeHomeworkGroup`：首页作业组归一化，输出 `operationId`、`assignmentDateText`、`teacherName`、`assignments`、练习/提交要求；无作业时 `statusText` 为「等待老师布置作业」；
- `normalizeCourseItems(data, section, keyword)`：课程四分区（`track / knowledge / track-set / knowledge-set`）列表归一化，内置类型 → 页面路径映射和本地搜索过滤；注意里面有 mock 兜底值（如 `index % 4` 生成的 countLabel / 更新日期），接真实接口后应删掉兜底、信任后端字段；
- `normalizeLibraryItems`：图书馆列表归一化，`getFileType()` 从 URL / MIME / 扩展名推断 `PDF / MP3 / JPG / PNG` 等，输出 `sizeText`、`updateDateText`；
- `normalizeHomeworkHistory`：历史记录归一化，每条输出一个操作盒（`operationId`、`dateText`、`teacherName`、`assignments`、`deleted`、`deleteReason`）。

协作注意：

- 归一化函数统一做「驼峰 + 下划线」双格式兼容，后端两种命名都能接，但新接口建议统一驼峰；
- 改动任何 normalize 函数时，要同步检查使用它的页面和 mock 数据结构。

---

## 4. 服务层与接口清单

所有接口请求都通过 `services/request.js`。页面不要直接写 `wx.request`。

### 4.1 服务文件

| 文件 | 职责 | 实际端点 |
|---|---|---|
| `services/auth.js` | 登录、登出、当前学生、会话守卫 | `POST /login`、`POST /logout`、`GET /me` |
| `services/homework.js` | 今日作业、历史作业 | `GET /homework/today`、`GET /homework/history?page=&pageSize=` |
| `services/courses.js` | 课程四分区、详情、合集 | `/tracks`、`/knowledge`、`/tracks/:id`、`/knowledge/:id`、合集详情 |
| `services/library.js` | 图书馆列表与详情 | `GET /library?keyword=`、`GET /library/:id` |
| `services/files.js` | 文件预签名 URL、PDF/图片/音频打开 | `GET /files/:fileId/signed-url?source=` |

### 4.2 后端需支持的端点

后端统一挂在 `/api/miniprogram` 下：

```text
POST /login
POST /logout
GET  /me
GET  /homework/today
GET  /homework/history?page=1&pageSize=20
GET  /tracks?type=track_point&keyword=&sort=updated_desc&page=1&pageSize=20
GET  /tracks?type=track_collection&keyword=&sort=updated_desc&page=1&pageSize=20
GET  /knowledge?type=knowledge_point&keyword=&sort=updated_desc&page=1&pageSize=20
GET  /knowledge?type=knowledge_collection&keyword=&sort=updated_desc&page=1&pageSize=20
GET  /tracks/:id
GET  /tracks/collections/:id
GET  /knowledge/:id
GET  /knowledge/collections/:id
GET  /library?keyword=
GET  /library/:id
GET  /files/:fileId/signed-url?source=library|attachment
```

约定：

- 排序参数当前页面使用：`updated_desc`、`updated_asc`、`title`；
- 课程四分区类型：`track_point`、`track_collection`、`knowledge_point`、`knowledge_collection`；
- 文件预签名返回兼容 `{ url }` 或 `{ signedUrl }`；
- 登录返回建议稳定为 `{ token, student, expiresAt }`；
- 私密内容（`visibility='private'`）由后端过滤，学生端列表/详情/作业不会返回私密项；私密视频不下发永久地址，改下发 `authorizeEndpoint`（`/api/playback/videos/:id/play-url`），学生端无需处理。

---

## 5. 页面实现要点

### 5.1 登录页

`pages/login/index.js`

- 调 `login({ account, password })`；
- 成功后 `getApp().setSession(result)`；
- 跳转 `wx.switchTab({ url: '/pages/home/index' })`；
- 当前没有注册、openid 绑定、短信验证码逻辑。

### 5.2 首页

`pages/home/index.js`

- `onShow()` 先 `requireLogin()`；
- 调 `getTodayHomework()`；
- 用 `normalizeHomeworkGroup()` 归一化；
- 点击作业内任意内容走 `navigateByAssignment()`，支持六类内容跳转。

### 5.3 课程页

`pages/courses/index.js`

- 默认分区：`knowledge-set`；
- 四分区：`knowledge-set` / `track-set` / `knowledge` / `track`；
- 排序项：时间倒序、时间正序、按标题；
- 搜索框输入后立即重新加载；
- 返回顶部用 `wx.pageScrollTo`；
- 页面卡片 URL 由 `normalizeCourseItems()` 生成。

### 5.4 图书馆

`pages/library/index.js`

- 只展示 `fileType === 'PDF'` 的资料；
- 搜索在接口请求后还会本地过滤标题；
- 预览与下载当前共用 `previewPdf()`，底层走 `openLibraryFile()`；
- 如果接口 404，会提示「服务器暂未部署图书馆接口」。

### 5.5 历史页

`pages/history/index.js`

- 固定拉取第一页 20 条；
- 用 `normalizeHomeworkHistory()` 归一化；
- 搜索是本地过滤，范围包括老师名、标题、练习要求、提交要求、作业标题和类型；
- 返回顶部用 `wx.pageScrollTo`。

### 5.6 我的页

`pages/mine/index.js`

- 学生信息来自 `requireLogin()` 的本地 student；
- 头像首字取 `nickname || username || account || '学'`；
- 退出时先尝试 `POST /logout`，无论成功失败都会 `getApp().clearSession()` 并 `reLaunch` 到登录页。

### 5.7 合集详情页

`pages/track-collection/index.js`、`pages/knowledge-collection/index.js`

- 调对应合集接口；
- `raw.items || raw.lessons || []` 作为列表来源；
- 点击内容跳到对应详情页：曲目进 `track-detail`，知识点进 `knowledge-detail`。

---

## 6. 播放器与文件打开

### 6.1 视频播放详情

适用页面：

```text
pages/track-detail/index
pages/knowledge-detail/index
```

两页通过 `utils/create-video-detail-page.js` 复用播放器状态、生命周期和交互逻辑，各自的 `index.js` 只配置详情接口、默认标题和错误文案；`knowledge-detail/index.wxss` 直接 `@import "../track-detail/index.wxss"`。

当前播放器实现：

- `<video id="lessonVideo">` 关闭原生 controls / play button / fullscreen button；
- 使用 `wx.createVideoContext('lessonVideo', this)` 控制；
- 自定义控制条支持播放/暂停、进度拖动、当前/总时长、清晰度、倍速、全屏；
- 清晰度来自 `part.renditions[]`，只保留有 `videoUrl` 且 `status` 为空或 `ready` 的项；
- 默认清晰度优先级：`720p` → `source` → 第一项；
- 倍速档位使用微信 `video` 真机支持的值：`[0.5, 0.8, 1, 1.25, 1.5, 2]`；
- `bindloadedmetadata` 根据视频宽高决定全屏方向，横屏用 `direction: 90`，竖屏用 `direction: 0`；
- 进度条是“大热区 + 视觉轨道 + 滑块 + 拖动时间气泡”；
- 原生 `enable-progress-gesture` 已关闭，进度热区使用拦截型触摸事件，避免 iOS 原生视频手势抢占自定义拖动；
- 拖动开始时缓存视觉轨道尺寸，拖动中不重复查询节点；释放时只 seek 一次，拖动期间 `isSeeking` 会阻止 timeupdate 覆盖 UI；
- 全屏状态以 `bindfullscreenchange` 的 `event.detail.fullScreen` 为准，并记录 `fullscreenDirection`；
- 全屏控制条保持常驻，避免 iOS 原生全屏层在控制条隐藏后无法再次把点击派发给页面；
- 全屏进度拖动按屏幕宽度和安全区计算轨道范围，不依赖 iOS 原生视频层中可能失效的节点测量；
- 退出全屏通过 `exitFullscreenWithFallback()` 执行，500ms 后仍未同步时会兜底重置本地全屏状态；
- 控制条已拆成“进度条层 + 控制按钮层”，小窗、横屏全屏、竖屏全屏共用同一套结构；
- 横屏全屏控制层使用固定像素尺寸并适配左右及底部安全区域；小窗可自动隐藏，全屏始终保留可操作控制层；
- 播放、暂停和全屏图标使用本地 PNG，不依赖 iOS / Android 字体或 `cover-view` 的复杂边框绘制；
- 倍速按钮在小窗和全屏都显示，点击后通过播放器内弹窗选择具体档位；
- 视频画面统一使用 `contain`，避免异形屏横屏全屏时拉伸；
- 视频缓冲通过 `bindwaiting` 显示“视频加载中…”；
- 视频失败通过 `binderror` 显示友好错误态；
- 清晰度切换会记录原清晰度、原时间和原 detail，切换失败时自动恢复原画面；
- 单一视频源不显示清晰度切换按钮；
- 页面首次加载后主动播放一次，返回页面不会重新请求或自动恢复播放；异步回调仅在页面可见时允许播放；
- `onHide` / `onUnload` 会暂停当前视频，并清理控制条、拖动气泡和全屏兜底定时器。

### 6.2 音频播放页

`pages/audio-player/index.js`

- 通过 URL query 接收 `fileId`、`fileSource`、`title`、`source`、`coverUrl`、`format`；
- 先调 `getSignedUrl()` 获取音频地址，再 `wx.createInnerAudioContext()`；
- 不在 onLoad 自动播放，首次点击播放时如果实例不存在会先 prepare 再 play；
- 播放前会调用 `wx.setInnerAudioOption({ obeyMuteSwitch: false })`，降低 iPhone 静音键导致无声的风险；
- 会校验音频 URL：空地址、非 HTTPS、包含空格都会提示用户；
- 倍速档位：`[0.5, 0.75, 1]`；
- 播放进度使用自定义轨道和拖动热区，避免原生 `slider` 在 iOS / Android 上外观和触摸反馈不一致；
- 快进/快退步长按音频长度动态计算：≤30s 为 5s，≤90s 为 10s，更长为 15~30s；
- 循环开关直接设置 `audio.loop`；
- 已补齐 `onCanplay`、`onPlay`、`onPause`、`onStop`、`onTimeUpdate`、`onEnded`、`onWaiting`、`onError` 状态同步；
- 页面会显示“音频加载中…”和错误提示；
- `onHide` / `onUnload` 会 stop + destroy，销毁过程带异常兜底。

### 6.3 文件打开

`services/files.js` 的 `openLibraryFile(file)` 负责统一分流：

```text
MP3       → navigateTo /pages/audio-player/index
JPG/PNG   → wx.previewImage
PDF/其他  → getSignedUrl → wx.downloadFile → wx.openDocument(showMenu: true)
```

`downloadAndOpenDocument()` 失败时会提示「文件下载失败，请检查开发者工具是否关闭域名校验」。真机调试还要确认 downloadFile 合法域名。

---

## 7. UI 与协作红线

当前小程序已经经过多轮视觉校对，后续开发不要轻易改整体风格。

统一视觉方向：

- 主色：深棕 `#5d4326`；
- 辅助棕：`#7a6a52`；
- 页面背景以白色和浅棕格子底为主；
- 避免廉价渐变；
- 避免高饱和黄色 / 橙色角标；
- 封面卡片上不再显示 `P`、`知识`、`PDF` 等橘色角标；
- 长标题必须单行省略；
- 搜索框、按钮、返回顶部按钮保持页面间统一。

协作红线：

1. 小程序端只改 `miniprogram/` 内相关文件；
2. 不为小程序随意修改网页端页面或网页端既有接口返回结构；
3. 页面内不要散落硬编码后端域名；
4. 不新增注册、微信 openid 绑定、支付、广告、会员能力；
5. 不把 UI 同事写给开发者的提示文案展示给学生；
6. 不恢复旧版“资料”Tab 命名，当前统一叫“图书馆”；
7. 新增页面必须在 `app.json` 注册；
8. 新增接口必须走 `services/request.js`；
9. 新增业务对象类型时同步改 `utils/constants.js` 和 `utils/navigate.js`。

---

## 8. 已知技术债

- `normalizeCourseItems()` 里仍有部分 mock 兜底值（例如用 index 生成内容数和更新日期），接真实后端字段后应移除；
- iPhone 音频无声已做前端兜底，但仍需真机验证签名 URL、Content-Type、Range 支持和微信合法域名配置；
- `library-detail` 仍保留 `preview=pdf` 的占位承载逻辑，当前主流程图书馆预览直接走 `openLibraryFile()`；
- `services/files.js` 的下载错误提示仍带「开发者工具是否关闭域名校验」，真机问题需要结合合法域名排查。

---

## 9. 私密内容与学生端行为

后端已上线「分 P 公开/私密」能力（`visibility` 字段，`public` / `private`），小程序作为**纯学生端**的结论是：**前端无需额外改动即可正确过滤私密内容**。原因如下：

- 课程四分区列表、合集详情、单课/单知识点详情、附件、作业的**后端 SQL 均已按「公开」过滤**（`COALESCE(NULLIF(visibility,''),'public') = 'public'` 及「存在公开 P」派生口径），学生端拿到的都是公开数据。
- 私密 P 不会下发永久视频地址，而是下发 `authorizeEndpoint`（`/api/playback/videos/:id/play-url`）占位；但学生端根本看不到私密 P，因此详情页只需消费公开 P 的 `videoUrl` / `playUrl`，无需适配授权端点。
- 附件下载已统一走 `/files/:fileId/signed-url`（`services/files.js` 的 `getSignedUrl()`），非永久直链，符合「下载前授权」要求。

协作约束：

- 小程序端**不新增管理入口**（公开/私密开关在网页端 `/admin/tracks`、`/admin/knowledge` 编辑页）；
- 若未来需要在学生端展示「老师端才可见」的私密标识，必须先与网页端口径对齐，不要在页面里自行判断 `visibility` 字段；
- 学生端历史作业中「教学内容已调整」文案由后端对私密目标脱敏后下发，前端只负责展示。

---

## 10. 后续修改 README 的规则

- 每次新增页面、接口、服务文件、对象类型或播放器行为，都同步更新本文档；
- 不要把开发计划、阶段表、待办清单写回这里；
- 待办和调研方案放到 `docs/miniprogram代办清单/`；
- 本 README 只保留当前架构、接口契约、协作注意点和已知技术债。
