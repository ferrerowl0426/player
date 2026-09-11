# 能学慧吉他教室 · 项目交接 README

这是给下一位程序员 / AI 编码助手的交接文档。详细需求不要以 README 为准，必须优先阅读：

1. [PRD.md](file:///c:/Users/user/Desktop/播放器/docs/PRD.md)
2. [开发计划-组件复用与实施.md](file:///c:/Users/user/Desktop/播放器/docs/开发计划-组件复用与实施.md)
3. [design-spec.md](file:///c:/Users/user/Desktop/播放器/docs/design/guitar-home/design-spec.md)
4. [docs/design/guitar-home](file:///c:/Users/user/Desktop/播放器/docs/design/guitar-home) 下对应页面设计稿

README 只记录当前代码状态、启动方式、已完成阶段和接手注意事项。

---

## 1. 当前项目定位

项目已从“通用视频播放器”演进为：

> 能学慧吉他教室内部教学平台。

核心对象不再是单一 `video` 页面，而是：

- 曲目区：单曲目 `track_point`、曲谱集 `track_collection`、曲目 P 分段 `track_part`
- 知识点区：单知识点 `knowledge_point`、知识点集 `knowledge_collection`、知识点 P 分段 `knowledge_part`
- 图书馆：`library_resource`
- 通用前置关系：`prerequisites`
- 通用作业：`user_assignments.object_type / object_id / part_id`

旧的视频首页、旧 `/videos/[id]`、旧后台视频管理仍有残留，但已在代码里加 TODO 标注，后续应按开发计划退役。

---

## 2. 当前必须遵守的文档口径

### 2.1 表名 / object_type 新口径

旧名不要再用。

| object_type | 表 |
|---|---|
| `track_point` | `track_points` |
| `track_collection` | `track_collections` |
| `track_part` | `track_parts` |
| `knowledge_point` | `knowledge_points` |
| `knowledge_collection` | `knowledge_collections` |
| `knowledge_part` | `knowledge_parts` |
| `library_resource` | `library_resources` |

已废弃旧名：

- `tracks`
- `collections`
- `collection_tracks`
- `kp_parts`
- `kp_collections`
- `kp_collection_items`
- `track`
- `collection`
- `kp_*`

### 2.2 前置关系规则

- 统一使用 `prerequisites` 表。
- 允许多级前置。
- 不做环形依赖判定。
- 只禁止对象直接指向自身。

### 2.3 数据迁移规则

开发环境不做旧测试数据迁移。

M0 的约定是：

- 删除旧测试数据。
- 清空 MinIO / COS 存储桶。
- 按新模型重新建表和 seed。

---

## 3. 技术栈与端口

### 前端

- Next.js App Router
- React
- JavaScript
- 全局样式在 [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css)

本地端口固定：

```txt
http://localhost:3001
```

### 后端

- Node.js
- Express
- PostgreSQL
- S3 兼容对象存储：本地 MinIO / 生产 COS

本地端口固定：

```txt
http://localhost:3000
```

不要再把前端指向旧的 `3002`。

---

## 4. 本地启动与重置

### 4.1 启动依赖

本地依赖由 Docker 提供，通常包括 PostgreSQL 和 MinIO。先确保 Docker Desktop 已启动。

### 4.2 重置测试环境

```bash
cd backend
npm run test:reset
```

该脚本当前会：

- DROP public schema 下旧表并重新建表。
- 清空对象存储桶。
- 执行 [ensureAppSchema](file:///c:/Users/user/Desktop/播放器/backend/src/db.js)。
- 重建测试账号、班级、学生。

### 4.3 启动后端

```bash
cd backend
$env:PORT='3000'; npm start
```

健康检查：

```txt
http://localhost:3000/api/health
```

### 4.4 启动前端

```bash
cd frontend
$env:PORT='3001'; npm run dev
```

如果出现 Next dev 缓存错误，例如：

- `.next/server` 缺 chunk
- React Client Manifest 找不到模块
- `__webpack_modules__[moduleId] is not a function`

处理方式：停止前端 dev server，删除 `frontend/.next`，再重新启动前端。

---

## 5. 测试账号

当前测试账号密码统一为：

```txt
admin123
```

常用账号：

| 身份 | 账号 | 密码 |
|---|---|---|
| 教导主任 | `admin` | `admin123` |
| 老师 | `teacher_a` | `admin123` |
| 老师 | `teacher_b` | `admin123` |
| 学员 | `student_a1` | `admin123` |

登录页为：

```txt
http://localhost:3001/login
```

游客入口应进入 `/tracks`。

---

## 6. 当前已完成阶段

### M0：清理、初始化与数据地基

已完成。

重点：

- 重新建表。
- 清空测试数据和存储桶。
- 新表名已按 PRD §4.4 同步。
- `video_renditions` 已加入。
- 后端默认端口改为 `3000`。

相关文件：

- [db.js](file:///c:/Users/user/Desktop/播放器/backend/src/db.js)
- [reset-test-environment.js](file:///c:/Users/user/Desktop/播放器/backend/scripts/reset-test-environment.js)
- [config.js](file:///c:/Users/user/Desktop/播放器/backend/src/config.js)

### M1：权限基础设施与媒体关联

已完成。

重点：

- `requireRole / requireAdmin / requireSuperAdmin` 权限体系。
- 停用账号校验。
- 通用前置关系接口。
- 视频清晰度状态 `video_renditions`。
- 删除链路：清理对象存储、前置关系、附件、图书馆关联，并写删除日志。
- 写接口仅教导主任可操作。

相关文件：

- [auth.js](file:///c:/Users/user/Desktop/播放器/backend/src/auth.js)
- [prerequisites.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/prerequisites.routes.js)
- [transcode.js](file:///c:/Users/user/Desktop/播放器/backend/src/transcode.js)
- [deletion.js](file:///c:/Users/user/Desktop/播放器/backend/src/deletion.js)
- [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js)
- [tracks.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/tracks.routes.js)
- [knowledge.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/knowledge.routes.js)

### M2：设计系统基建

已完成，但后续逐页还要按设计稿继续返工。

已落地：

- 设计 token。
- 设计稿公共类。
- [AppNav.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/AppNav.js)
- [ContentCard.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/ContentCard.js)
- [PanelBox.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/PanelBox.js)
- [ListRow.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/ListRow.js)
- [FiltersBar.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/FiltersBar.js)

旧 [layout.js](file:///c:/Users/user/Desktop/播放器/frontend/app/layout.js) 已不再渲染旧 `SiteHeader`。

### M3：曲目区与内容创建

当前已基本完成曲目区主链路返工。

已按设计稿处理：

- [tracks/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/tracks/page.js)
  - 对照 `tracks-home.html`
  - 上方曲目、下方曲谱集
  - 一条搜索同时过滤两区
  - 两区独立排序、分页、空态
  - 游客不显示作业记录
  - 教导主任显示「新建单曲目 / 新建曲谱集」

- [tracks/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/tracks/[id]/page.js)
  - 对照 `track-point-detail.html`
  - 面包屑、标题、前置知识点、播放器、简介
  - 右侧三盒：播放列表、资料下载、所属曲谱集
  - 视频播放器支持 ready 清晰度菜单

- [tracks/collections/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/tracks/collections/[id]/page.js)
  - 对照 `track-collection-detail.html`
  - 合集头部、收录曲目网格、分页、资料区

- [admin/tracks/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/tracks/page.js)
  - 对照 `admin-create-track-point.html`
  - 新建 / 编辑单曲目
  - P 分段上传
  - 前置内容选择

- [admin/tracks/collections/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/tracks/collections/page.js)
  - 对照 `admin-create-track-collection.html`
  - 新建曲谱集
  - 从已有单课多选加入
  - 前置内容选择
  - 曲目调序

- [admin/upload/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/upload/page.js)
  - 对照 `admin-create-entry.html`
  - 作为创建入口跳转页

M3 已验证过：

- `npm run build` 成功。
- `/tracks` 返回 200。
- `/tracks/1` 返回 200。
- `/admin/tracks` 返回 200。
- `/admin/tracks/collections` 返回 200。
- `/admin/upload?zone=track&type=collection` 返回 200。

---

## 7. 当前代码里已标注的旧样式 / 后续删除项

以下文件仍有旧实现或旧样式，代码中已加 TODO，后续阶段按开发计划处理：

| 文件 | 状态 |
|---|---|
| [app/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/page.js) | 旧视频首页 / 学员首页，后续 M8 按 `student-home.html` 返工 |
| [videos/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/videos/[id]/page.js) | 旧通用视频详情页，后续退役，统一走 `/tracks/[id]`、`/knowledge/[id]` |
| [admin/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/page.js) | 旧后台首页，仍有 `hero / video-section / VideoList` |
| [knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/page.js) | M4 按 `knowledge-home.html` 返工 |
| [knowledge/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/[id]/page.js) | M4 复用曲目详情骨架返工 |
| [knowledge/collections/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/collections/[id]/page.js) | M4 按知识点集详情设计稿返工 |
| [admin/knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/knowledge/page.js) | M4 按内容创建页同构返工 |

不要继续扩展这些旧样式；新开发必须走 PRD + 设计稿 + M2 组件。

---

## 8. 下一步建议

按 [开发计划-组件复用与实施.md](file:///c:/Users/user/Desktop/播放器/docs/开发计划-组件复用与实施.md) 继续，下一张任务卡应是：

```txt
M4 知识点区
```

M4 要求：

- 与曲目区完全同构。
- 不另写一套样式。
- 复用 M3 的页面骨架和组件。
- 参照：
  - `knowledge-home.html`
  - `knowledge-collection-detail.html`
  - 曲目详情同构稿 `track-point-detail.html`
  - `admin-create-track-point.html` / `admin-create-track-collection.html` 的管理端同构结构

重点文件：

- [knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/page.js)
- [knowledge/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/[id]/page.js)
- [knowledge/collections/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/collections/[id]/page.js)
- [admin/knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/knowledge/page.js)
- [knowledge.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/knowledge.routes.js)

---

## 9. 开发纪律

1. 每次开工先读 PRD 对应章节和设计稿。
2. 前端页面必须逐块对照设计稿，不接受“风格接近”。
3. 不要重写分片上传，调用 [uploadVideo.js](file:///c:/Users/user/Desktop/播放器/frontend/components/uploadVideo.js) 现有能力。
4. 不要修改 [storage.js](file:///c:/Users/user/Desktop/播放器/backend/src/storage.js) 的核心对象存储流程，除非 PRD 明确要求。
5. 不要做旧数据迁移，测试环境清空重建。
6. 发现旧样式可以先标 TODO，但不要在新页面继续沿用。
7. 写接口必须后端鉴权，前端隐藏入口不算安全。
8. 后续启动端口固定：后端 `3000`，前端 `3001`。

---

## 10. 快速验证清单

```txt
后端健康检查：
http://localhost:3000/api/health

前端：
http://localhost:3001/login
http://localhost:3001/tracks
http://localhost:3001/admin/tracks
http://localhost:3001/admin/tracks/collections
```

前端构建：

```bash
cd frontend
npm run build
```

后端常用接口验证：

```txt
GET /api/health
GET /api/tracks
GET /api/knowledge
POST /api/auth/login
POST /api/admin/login
```
