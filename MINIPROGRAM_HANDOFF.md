# 小程序端交接说明（MINIPROGRAM_HANDOFF）

> 本文仅用于“能学慧吉他教室”微信小程序学生端交接，避免与项目原有 README 混淆。  
> 适用范围：`miniprogram/` 前端、小程序专用后端接口 `/api/miniprogram/*`。  
> 非适用范围：不要把本文当作 Web 管理端 README，不要据此修改 `web/` 端文件。

## 1. 当前状态

### 已完成

- 小程序学生端前端页面已完成一轮按设计稿校对。
- 已实现并反复调整以下页面：
  - 登录页
  - 首页
  - 课程页
  - 知识点集详情页
  - 曲目集详情页
  - 播放详情页
  - 音频播放页
  - 图书馆页
  - 历史记录页
  - 我的页
- 本地 Docker 后端服务已启动过，开发目标是继续在现有后端上补充小程序接口。
- 前端当前主要依赖 `miniprogram/utils/mock.js` 的测试数据，后续需要逐步切换到真实接口。

### 待完成

- 在后端新增小程序专用接口，统一挂载到：

```text
/api/miniprogram/*
```

- 严格按 PRD 第一阶段接口范围开发。
- 不要修改 Web 管理端已有页面和逻辑。

## 2. 重要边界

### 必须遵守

1. 后端新增接口必须放在小程序命名空间下：`/api/miniprogram/*`。
2. 小程序接口文件建议放在后端独立目录中，例如：

```text
backend/miniprogram/
```

或如果后端原结构使用 `src`：

```text
backend/src/miniprogram/
```

以实际后端入口结构为准，但必须保持 `miniprogram` 命名，方便交接和隔离。

3. 不要改 `web/` 目录。
4. 不要把小程序接口混进 Web 管理端原有 route/controller 中。
5. 不要引入云开发。
6. 不要绑定 openid。
7. 不开放公众注册。
8. 认证应复用现有后端的 JWT/Cookie 或项目已有登录体系。

### 禁止事项

- 禁止重构 Web 端。
- 禁止改动 Web 管理端接口行为来适配小程序。
- 禁止为了小程序临时改数据库核心结构，除非 PRD 明确要求并有 migration。
- 禁止把 mock 数据长期留作正式接口返回。
- 禁止在页面中展示 UI 设计稿里的开发提示文案。

## 3. 技术栈和目录说明

### 前端

```text
miniprogram/
```

微信原生小程序，不使用云开发。

关键文件：

```text
miniprogram/app.json
miniprogram/utils/constants.js
miniprogram/utils/mock.js
miniprogram/utils/format.js
miniprogram/pages/*
```

当前接口前缀配置在：

```text
miniprogram/utils/constants.js
```

目前值为：

```js
API_BASE_URL = 'http://localhost:3000/api/miniprogram'
```

后端接口完成后，前端应从 mock 数据逐步切换为真实接口。

### 后端

```text
backend/
```

现有后端为 Node.js / Express / PostgreSQL / 对象存储相关能力。小程序端只需要新增专用接口层，不要破坏现有 Web 管理端。

推荐新增结构：

```text
backend/miniprogram/
  routes/
  controllers/
  services/
  repositories/
  serializers/
  validators/
  index.js
```

如果现有后端采用 `src` 目录，则使用：

```text
backend/src/miniprogram/
  routes/
  controllers/
  services/
  repositories/
  serializers/
  validators/
  index.js
```

入口文件只做一件事：挂载路由。

示例：

```js
app.use('/api/miniprogram', miniprogramRouter)
```

## 4. 第一阶段接口范围建议

以 PRD 为准，第一阶段优先满足学生端页面闭环。建议接口分组如下。

### 4.1 登录与会话

```text
POST /api/miniprogram/auth/login
POST /api/miniprogram/auth/logout
GET  /api/miniprogram/auth/me
```

说明：

- 复用现有账号体系。
- 不做 openid 绑定。
- 不开放注册。
- 登录成功返回学生基础信息和会话凭据。

### 4.2 首页

```text
GET /api/miniprogram/home
```

建议返回：

- 学生姓名
- 今日作业/当前作业
- 今日用到的课件
- 最近学习记录摘要

### 4.3 课程列表

```text
GET /api/miniprogram/courses
```

查询参数建议：

```text
type=knowledge|track|knowledge_collection|track_collection
keyword=
sort=latest|default
page=
pageSize=
```

说明：

- 列表卡片必须返回前端展示所需字段。
- 合集类需要返回内容数量和最近更新时间。

### 4.4 知识点集详情

```text
GET /api/miniprogram/knowledge-collections/:id
```

建议返回：

- 合集基础信息
- 合集内知识点列表
- 每个知识点的封面、标题、更新时间、播放入口信息

### 4.5 曲目集详情

```text
GET /api/miniprogram/track-collections/:id
```

建议返回：

- 合集基础信息
- 合集内曲目列表
- 每个曲目的封面、标题、更新时间、播放入口信息

### 4.6 播放详情

```text
GET /api/miniprogram/knowledge/:id
GET /api/miniprogram/tracks/:id
```

建议返回：

- 标题
- 封面
- 视频/音频播放资源
- 分 P / 分段信息
- 前置知识点
- 附件列表

附件类型可能包括：

```text
pdf
mp3
zip
其他音频格式
```

### 4.7 图书馆

```text
GET /api/miniprogram/library
GET /api/miniprogram/library/:id/preview
GET /api/miniprogram/library/:id/download
```

说明：

- 图书馆只展示 PDF。
- 列表需要文件大小、更新日期、标题、封面或默认封面。
- 预览使用微信原生 `wx.openDocument`，后端应返回可访问的 PDF URL。
- 下载接口返回可下载 URL 或触发下载所需信息。

### 4.8 历史记录

```text
GET /api/miniprogram/history
```

查询参数建议：

```text
keyword=
page=
pageSize=
```

说明：

- 每一次老师操作聚合为一个记录盒子。
- 支持作业布置、资料推送、作业删除等记录。
- 删除态需要返回删除原因，并让前端能降低整盒透明度。

## 5. 返回格式约定

建议保持统一格式：

```json
{
  "success": true,
  "data": {},
  "message": "ok"
}
```

分页接口建议：

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 0,
      "hasMore": false
    }
  },
  "message": "ok"
}
```

错误格式建议：

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "请先登录"
  }
}
```

## 6. 数据字段命名建议

为了减少前端适配成本，接口返回字段建议尽量贴近小程序当前 mock 数据。

### 课程卡片

```json
{
  "id": "string",
  "type": "track",
  "title": "标题",
  "coverUrl": "https://...",
  "teacherName": "老师名",
  "durationText": "03:20",
  "contentCount": 8,
  "updateDateText": "10月8日",
  "createdAt": "2026-10-08T00:00:00.000Z",
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

### 附件

```json
{
  "id": "string",
  "name": "附件名.pdf",
  "type": "pdf",
  "sizeText": "2.4 MB",
  "url": "https://...",
  "canPreview": true,
  "canPlay": false,
  "canDownload": true
}
```

### 图书馆 PDF

```json
{
  "id": "string",
  "title": "PDF 标题",
  "coverUrl": "https://...",
  "fileUrl": "https://...",
  "sizeText": "3.2 MB",
  "updateDateText": "10月8日",
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

### 历史记录

```json
{
  "id": "string",
  "type": "assignment_created",
  "title": "记录标题",
  "teacherName": "雨涵老师",
  "createdAt": "2026-10-08T00:00:00.000Z",
  "dateText": "10月8日",
  "items": [],
  "deleted": false,
  "deleteReason": ""
}
```

## 7. 小程序视觉和交互红线

后续接接口时不要破坏已校对的 UI。

1. 棕色系为主：深棕 `#5d4326`，常用棕 `#7a6a52`，浅棕底 `#f7f1e6` / `#f6f3ee`。
2. 不要使用廉价渐变。
3. 页面里不要出现 UI 给开发看的提示文案。
4. 课程页分段控件不要用小程序原生 `button`，已改为 `view` 自绘。
5. 标题超长必须单行省略，避免卡片换行挤乱。
6. 图书馆只展示 PDF。
7. PDF 预览走微信原生 `wx.openDocument`。
8. 音频页保留 5 个控件：循环、快退、播放/暂停、快进、倍速。
9. 课程页、图书馆页、历史页均有回到顶部按钮。
10. 封面卡片不要再加橘色类型角标或 PDF 角标。

## 8. 后端实现建议

### 分层

推荐：

```text
routes -> controllers -> services -> repositories -> database
```

原则：

- route 只定义路径和中间件。
- controller 只处理 req/res 和参数读取。
- service 写业务规则。
- repository 只负责数据库查询。
- serializer 负责把数据库字段转为小程序前端字段。

### 认证

- 小程序端复用现有登录体系。
- 需要登录的接口统一走认证中间件。
- 未登录返回 401，不要返回 HTML。

### 文件访问

- 视频、音频、PDF、ZIP 等资源不要直接经过 API Server 传大文件。
- 后端应返回可访问 URL，必要时使用预签名 URL。
- PDF 预览 URL 必须能被微信 `wx.openDocument` 使用。

## 9. 建议开发顺序

1. 读取后端入口文件，确认 Express app 挂载位置。
2. 新建 `miniprogram` 接口目录。
3. 新建统一 response helper。
4. 新建 auth/me 或临时会话验证接口。
5. 新建 home 接口。
6. 新建 courses 列表接口。
7. 新建 collection detail 接口。
8. 新建 play detail 接口。
9. 新建 library 接口。
10. 新建 history 接口。
11. 在后端入口挂载 `/api/miniprogram`。
12. 做本地冒烟测试。
13. 再把小程序端从 mock 切到真实接口。

## 10. 验证清单

后端接口完成后至少验证：

```text
GET  /api/miniprogram/auth/me
GET  /api/miniprogram/home
GET  /api/miniprogram/courses
GET  /api/miniprogram/library
GET  /api/miniprogram/history
```

如果接口需要登录，验证：

- 未登录返回 401 JSON。
- 已登录返回统一 JSON。
- 不返回 HTML 错误页。

前端验证：

- 首页作业盒子正常。
- 课程页四类型切换正常。
- 合集详情能进入。
- 播放详情标题不显示分 P 标题，不显示 720P。
- 图书馆只显示 PDF。
- 历史记录按每次操作聚合。

## 11. 交接重点

下一位开发者接手时，请优先关注：

1. 后端新增接口是否严格放在 `/api/miniprogram/*`。
2. 是否只改了 `backend/`，没有动 `web/`。
3. 接口字段是否能直接喂给 `miniprogram/utils/format.js`。
4. 文件 URL 是否适配微信小程序预览/播放。
5. mock 数据是否已经逐步替换为真实接口。

## 12. 当前风险

- 后端目录中 `node_modules` 很大，排查结构时不要扫描整个 `backend`。
- 建议只读取明确文件，例如：

```text
backend/package.json
backend/server.js
backend/app.js
backend/src/server.js
backend/src/app.js
```

不存在就跳过，不要递归扫描。

- 小程序端 UI 已被反复校对，接接口时尽量只改数据层，不要顺手改样式。
