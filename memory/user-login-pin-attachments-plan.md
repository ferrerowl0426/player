# 用户登录、置顶作业和资料附件功能方案

## 1. 目标

当前项目只有管理员登录，普通用户可以直接访问首页。下一阶段要改成：

1. 普通用户也必须登录后才能看视频。
2. 普通用户和管理员使用不同登录页面。
3. 普通用户首页顶部有独立的置顶区域，栏目名称是“今日的作业”。
4. 管理员可以给指定用户推送置顶内容，内容可以包含：
   - 已有视频
   - 留言内容
5. 如果用户没有置顶视频，前端显示“管理员还没有推荐视频”。
6. 如果用户没有留言，前端显示“管理员没有给你留言”。
7. 管理员可以查看每个用户的历史推送记录。
8. 管理员删除历史推送时，不物理删除数据库记录，只把记录标记为已删除并变灰，同时必须填写删除原因，例如“手误”。
9. 上传视频时可以附带资料文件，例如 PDF、Word、MP4 等。
10. 普通用户下载资料时，文件从 COS 下载，不走后端带宽。
11. 项目仍然走 Docker 部署。
12. 新增代码必须写适合新手理解的注释。

## 2. 账号规则

### 2.1 管理员

管理员账号用于后台管理。

第一版规则：

1. 系统至少保留一个管理员。
2. 后端启动时仍然初始化默认管理员：
   - 用户名：admin
   - 密码：123456
3. 管理员可以创建其他管理员。
4. 管理员可以重置其他管理员密码。
5. 管理员不能删除最后一个管理员，避免系统没有管理员可登录。

### 2.2 普通用户

普通用户用于访问前台视频和今日作业。

第一版规则：

1. 后端启动时初始化一个测试普通用户：
   - 用户名：demo
   - 密码：123456
2. 其他普通用户由管理员创建。
3. 管理员创建普通用户时填写用户名和初始密码。
4. 普通用户密码只能由管理员重置，普通用户第一版不做自己修改密码。
5. 管理员线下分发普通用户密码。

## 3. 登录页面

### 3.1 普通用户登录页

建议路径：

```text
/login
```

作用：

1. 普通用户输入用户名和密码。
2. 登录成功后跳转普通首页 `/`。
3. 后端设置普通用户专用 HttpOnly Cookie。

### 3.2 管理员登录页

保留现有路径：

```text
/admin/login
```

作用：

1. 管理员输入用户名和密码。
2. 登录成功后跳转管理员后台 `/admin`。
3. 后端设置管理员专用 HttpOnly Cookie。

### 3.3 Cookie 建议

管理员和普通用户要使用不同 Cookie 名称，避免身份混淆。

建议：

```text
管理员 Cookie：admin_token
普通用户 Cookie：user_token
```

两种 Cookie 都保持：

1. `httpOnly: true`，前端 JS 不能直接读取 token。
2. `sameSite: 'lax'`。
3. 生产环境 `secure: true`。
4. 本地 Docker 调试 `secure: false`。

## 4. 数据库设计

因为 Docker 的 PostgreSQL 数据卷可能已经存在，不能只依赖 `database/schema.sql` 初始化新表。

建议继续使用“后端启动时兜底建表”的方式：

1. `database/schema.sql` 保留基础表结构。
2. 后端启动时执行 `ensureAppSchema()`。
3. `ensureAppSchema()` 统一创建管理员表、普通用户表、推送记录表、附件表等。

### 4.1 admins 管理员表

当前已有 `admins` 表，可以扩展为：

```sql
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

第一版不需要加复杂角色字段，因为所有管理员权限相同。

### 4.2 users 普通用户表

新增普通用户表：

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

字段说明：

1. `username`：普通用户登录名。
2. `password_hash`：bcrypt 密码哈希，数据库不保存明文密码。
3. `is_active`：以后可以禁用用户，第一版也可以直接用上。
4. `created_at`：创建时间。

### 4.3 videos 视频表

当前 `videos` 表继续保留。

第一版不用把置顶字段写进 `videos` 表，因为置顶是“管理员给某个用户推送了某个视频”，它属于用户维度，不属于视频本身。

### 4.4 video_attachments 视频附件表

新增视频附件表：

```sql
CREATE TABLE IF NOT EXISTS video_attachments (
  id SERIAL PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

字段说明：

1. `video_id`：附件属于哪个视频。
2. `file_name`：用户看到的资料文件名。
3. `file_url`：COS 公开访问地址，普通用户下载时直接访问这个地址。
4. `file_key`：COS 对象 key，删除视频时用于删除附件对象。
5. `file_type`：文件 MIME 类型。
6. `file_size`：文件大小，后端最终应以 COS HeadObject 返回的真实大小为准。

### 4.5 user_assignments 用户推送记录表

新增用户推送记录表，也就是“今日的作业”和历史记录的核心表。

```sql
CREATE TABLE IF NOT EXISTS user_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  assigned_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  delete_reason TEXT NOT NULL DEFAULT '',
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

字段说明：

1. `user_id`：这条作业推给哪个普通用户。
2. `video_id`：推荐的视频，可以为空。为空时表示只有留言，没有视频。
3. `message`：管理员给用户的留言，可以为空。为空时表示只有视频，没有留言。
4. `assigned_by_admin_id`：哪位管理员创建的推送。
5. `is_deleted`：是否被管理员删除。删除后记录仍保留。
6. `delete_reason`：删除原因，删除时必填。
7. `deleted_at`：删除时间。
8. `created_at`：推送时间。

### 4.6 索引建议

为了列表查询更快，建议加：

```sql
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_video_attachments_video_id ON video_attachments (video_id);
CREATE INDEX IF NOT EXISTS idx_user_assignments_user_id_created_at ON user_assignments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_assignments_deleted ON user_assignments (is_deleted);
```

## 5. 后端接口设计

### 5.1 普通用户认证接口

新增路由文件建议：

```text
backend/src/user-auth.routes.js
```

接口：

```text
POST /api/user/login
GET  /api/user/me
POST /api/user/logout
```

说明：

1. `/api/user/login` 校验普通用户账号密码。
2. `/api/user/me` 检查普通用户是否登录。
3. `/api/user/logout` 清理普通用户 Cookie。

### 5.2 管理员账号管理接口

可以放在现有：

```text
backend/src/admin.routes.js
```

新增接口：

```text
GET  /api/admin/admins
POST /api/admin/admins
POST /api/admin/admins/:id/reset-password
DELETE /api/admin/admins/:id
```

注意：

1. 删除管理员时要检查管理员数量。
2. 如果只剩 1 个管理员，不能删除。
3. 密码进入数据库前必须 bcrypt hash。

### 5.3 普通用户管理接口

建议新增：

```text
GET  /api/admin/users
POST /api/admin/users
POST /api/admin/users/:id/reset-password
PATCH /api/admin/users/:id/status
```

说明：

1. 管理员可以创建普通用户。
2. 管理员可以重置普通用户密码。
3. 管理员可以禁用/启用普通用户。
4. 用户名、密码都要做边界校验。

### 5.4 今日作业接口

管理员接口：

```text
GET  /api/admin/users/:userId/assignments
POST /api/admin/users/:userId/assignments
PATCH /api/admin/assignments/:id/delete
```

普通用户接口：

```text
GET /api/user/assignments/today
GET /api/user/assignments/history
```

第一版解释：

1. 普通用户首页调用 `/api/user/assignments/today`。
2. 后端查询该用户最新一条或当天的未删除推送。
3. 如果没有视频，前端显示“管理员还没有推荐视频”。
4. 如果没有留言，前端显示“管理员没有给你留言”。
5. 管理员历史页面显示全部记录，包括已删除记录。
6. 已删除记录返回 `is_deleted=true` 和 `delete_reason`，前端显示灰色。

“今日”的判断需要明确。

第一版建议用：

```text
取该用户当天 created_at 的未删除推送，按创建时间倒序显示。
```

如果当天没有推送，则今日作业区域显示空状态。

### 5.5 视频附件上传接口

现有上传流程是：

1. 后端创建视频 Multipart 上传任务。
2. 浏览器直传视频分片到 COS。
3. 浏览器直传封面到 COS。
4. 后端完成分片合并。
5. 后端写入视频记录。

新增附件后，建议第一版这样改：

```text
POST /api/videos/multipart/create
```

请求里新增 `attachments` 元数据数组：

```json
{
  "title": "视频标题",
  "description": "视频介绍",
  "video": {},
  "cover": {},
  "attachments": [
    {
      "name": "资料.pdf",
      "size": 1024,
      "type": "application/pdf"
    }
  ]
}
```

后端返回每个附件的直传地址：

```json
{
  "attachments": [
    {
      "key": "attachments/xxx.pdf",
      "uploadUrl": "https://...",
      "publicUrl": "https://...",
      "fileName": "资料.pdf"
    }
  ]
}
```

```text
POST /api/videos/complete
```

请求里新增附件 key 列表：

```json
{
  "title": "视频标题",
  "description": "视频介绍",
  "videoKey": "videos/xxx.mp4",
  "coverKey": "covers/xxx.jpg",
  "attachments": [
    {
      "key": "attachments/xxx.pdf",
      "fileName": "资料.pdf"
    }
  ]
}
```

后端完成动作：

1. 校验视频对象真实存在。
2. 校验封面对象真实存在。
3. 校验每个附件对象真实存在。
4. 写入 `videos` 表。
5. 写入 `video_attachments` 表。

## 6. 边界校验要求

因为你明确要求“所有输入都要有边界校验”，第一版至少要做以下校验。

### 6.1 用户名

建议规则：

1. 必填。
2. 长度 3 到 50。
3. 只允许英文、数字、下划线。
4. 不允许 `null`、`undefined`、`NaN` 这类无意义文本。

### 6.2 密码

建议规则：

1. 必填。
2. 长度 6 到 72。
3. 前端做体验校验。
4. 后端做最终校验。
5. 数据库只保存 bcrypt hash。

### 6.3 留言

建议规则：

1. 可以为空。
2. 最多 1000 字。
3. 不允许 `null`、`undefined`、`NaN` 这类无意义文本。

### 6.4 推送视频

建议规则：

1. 视频可以为空。
2. 视频为空且留言也为空时，不允许创建推送。
3. 如果传了视频 id，必须确认视频存在。
4. 管理员搜索视频关键词最多 120 字。
5. 日期、页码、用户 id、视频 id 都要做格式校验。

### 6.5 删除原因

建议规则：

1. 删除推送记录时必填。
2. 最多 200 字。
3. 不允许 `null`、`undefined`、`NaN` 这类无意义文本。

### 6.6 附件

建议规则：

1. 单个视频最多 10 个附件。
2. 单个附件最大 100MB，后续可以按实际需要调整。
3. 文件名最多 180 字。
4. 允许扩展名第一版建议：
   - `.pdf`
   - `.doc`
   - `.docx`
   - `.ppt`
   - `.pptx`
   - `.xls`
   - `.xlsx`
   - `.zip`
   - `.mp4`
5. 前端传来的 `name / size / type` 不可信。
6. 后端在 `/complete` 时必须通过对象存储 `HeadObject` 获取真实大小。
7. 如果真实文件超限，后端应删除已上传对象，并拒绝入库。

## 7. 前端页面设计

### 7.1 普通用户页面

建议页面：

```text
/login
/
/videos/[id]
```

普通用户首页 `/`：

1. 进入页面先调用 `/api/user/me`。
2. 未登录跳转 `/login`。
3. 顶部显示“今日的作业”。
4. 今日作业区域显示管理员推送的视频和留言。
5. 没有视频时显示“管理员还没有推荐视频”。
6. 没有留言时显示“管理员没有给你留言”。
7. 下方继续显示视频列表、搜索和筛选。

视频详情页 `/videos/[id]`：

1. 也需要普通用户登录。
2. 显示视频播放器。
3. 显示附件下载列表。
4. 附件下载链接直接指向 COS URL。

### 7.2 管理员页面

建议页面：

```text
/admin
/admin/login
/admin/users
/admin/users/[id]/assignments
/admin/admins
```

第一版可以先做：

1. `/admin` 保留视频上传和视频管理。
2. `/admin/users` 管理普通用户。
3. `/admin/users/[id]/assignments` 管理某个用户的今日作业和历史推送。
4. `/admin/admins` 管理管理员账号。

管理员给用户推视频页面需要：

1. 用户信息。
2. 视频搜索框。
3. 搜索结果列表。
4. 留言输入框。
5. 推送按钮。
6. 历史推送记录。
7. 删除按钮。
8. 删除原因输入框或弹窗。
9. 已删除记录置灰显示删除原因。

## 8. COS 下载和带宽说明

资料文件上传到 COS 后，数据库只保存文件 URL 和 key。

普通用户下载资料时：

```text
浏览器 -> COS
```

而不是：

```text
浏览器 -> 后端 -> COS
```

这样不会占用后端服务器带宽。

第一版如果存储桶文件是公开读，可以直接使用 `file_url`。

如果未来改成私有读，后端只负责生成临时下载 URL，文件下载仍然是浏览器直接访问 COS 临时 URL，依然不走后端文件流量。

## 9. Docker 部署影响

Docker 部署方式继续保留：

```text
docker-compose.yml
docker-compose.local.yml
.env.local
.env
```

这次功能新增表较多，部署时要注意：

1. 不能只依赖 `database/schema.sql`。
2. 后端启动时必须执行统一初始化函数。
3. 已存在的 PostgreSQL Docker 数据卷也能自动补齐新表。
4. 本地调试继续用 `docker-compose.local.yml` 覆盖 `NODE_ENV=development`。
5. 生产环境继续用 `NODE_ENV=production`。

## 10. 建议分阶段实现

### 阶段一：账号体系

目标：普通用户和管理员都能登录。

包含：

1. 重构认证工具，支持 admin 和 user 两种身份。
2. 新增普通用户表。
3. 后端启动时初始化 demo 普通用户。
4. 新增普通用户登录、退出、me 接口。
5. 普通首页增加登录保护。
6. 新增 `/login` 普通用户登录页。

验收：

1. `demo / 123456` 可以登录普通首页。
2. 未登录访问 `/` 会跳到 `/login`。
3. 管理员登录仍然可用。
4. 本地 Docker 可以启动。

### 阶段二：管理员用户管理

目标：管理员可以管理普通用户和管理员。

包含：

1. 管理员创建普通用户。
2. 管理员重置普通用户密码。
3. 管理员禁用/启用普通用户。
4. 管理员创建其他管理员。
5. 管理员重置管理员密码。
6. 禁止删除最后一个管理员。

验收：

1. 管理员可以创建新普通用户。
2. 新普通用户可以登录。
3. 被禁用用户不能登录。
4. 系统始终至少保留一个管理员。

### 阶段三：今日作业和历史推送

目标：管理员可以给每个用户推送视频和留言。

包含：

1. 新增 `user_assignments` 表。
2. 管理员用户详情页显示历史推送。
3. 管理员通过搜索选择视频。
4. 管理员填写留言并推送。
5. 普通用户首页显示今日作业。
6. 删除推送时只标记删除，并要求填写原因。
7. 已删除历史记录置灰。

验收：

1. 管理员可以给 demo 推送视频和留言。
2. demo 登录后能看到今日作业。
3. 没有视频时显示“管理员还没有推荐视频”。
4. 没有留言时显示“管理员没有给你留言”。
5. 删除推送后历史记录仍在，但变灰并显示原因。

### 阶段四：视频附件资料

目标：上传视频时可以附带资料，普通用户可以从 COS 下载。

包含：

1. 新增 `video_attachments` 表。
2. 上传表单支持多选附件。
3. 后端生成附件直传 URL。
4. 浏览器直传附件到 COS。
5. `/videos/complete` 写入附件记录。
6. 视频详情页显示附件下载列表。
7. 删除视频时同步删除附件对象。

验收：

1. 管理员上传视频时可以附带 PDF、Word 等资料。
2. 普通用户视频详情页能看到资料列表。
3. 点击资料下载时，请求直接访问 COS 地址。
4. 删除视频后，视频、封面、附件对象都被清理。

### 阶段五：补充真实对象校验和清理

目标：提高上传安全性和资源清理能力。

包含：

1. `/multipart/complete` 后检查视频真实大小。
2. `/videos/complete` 检查封面和附件真实大小。
3. 超限时删除对象并拒绝入库。
4. 继续保留 COS 生命周期规则清理未完成 Multipart 分片。

验收：

1. 伪造前端 `size` 不能绕过后端限制。
2. 超限附件不会入库。
3. 中断上传不会长期堆积未完成分片。

## 11. 注释规范

因为项目用于学习，新增代码需要写注释，但注释要解释“为什么这样写”，不要重复代码表面意思。

建议：

1. 数据库初始化函数前写注释，说明 Docker 数据卷存在时为什么还要启动时建表。
2. Cookie 鉴权函数前写注释，说明为什么使用 HttpOnly Cookie。
3. COS 上传函数前写注释，说明为什么浏览器直传可以节省后端带宽。
4. 边界校验函数前写注释，说明前端校验不可信，后端才是安全边界。
5. 删除推送记录时写注释，说明为什么软删除而不是物理删除。

不建议：

```js
// 给变量赋值
const name = value;
```

建议：

```js
// 推送记录需要保留历史，所以删除时只标记状态，不从数据库物理删除。
```

## 12. 已确认的实现决策

1. “今日的作业”显示最新一天的推送记录：后端先找这个用户最近一次未删除推送所在的日期，再返回这一天内的所有未删除推送。
2. 附件单文件最大 100MB，第一版先按这个限制实现。
3. 普通用户登录后可以看到整个视频列表；管理员推送的视频和留言会在“今日的作业”区域额外拿出来展示。
