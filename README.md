# 能学慧吉他教室 · 项目交接 README

> **小程序端开发者请注意**：本 README 主要面向**网页端**。如果你接手的是微信小程序学生端，请直接阅读 [README-miniprogram.md](README-miniprogram.md) 和 [docs/PRD-小程序端学生功能.md](docs/PRD-小程序端学生功能.md)，本 README 只需按其中 §2「开工前必读」挑选部分章节阅读。

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

当前 M0–M9 开发阶段已经全部完成。现在不是继续新增里程碑，而是进入：

> 逐个页面对照 PRD 和 HTML 设计稿修 bug / 修视觉偏差 / 清理旧实现。

不要再按旧“视频播放器”思路开发页面。

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

## 3. 技术栈、端口与环境

### 前端

- Next.js App Router
- React
- JavaScript
- 本地端口固定：`http://localhost:3001`

### 后端

- Node.js
- Express
- PostgreSQL
- S3 兼容对象存储：本地 MinIO / 生产 COS
- 本地端口固定：`http://localhost:3000`

不要再把前端指向旧的 `3002`。

端口口径必须在三种环境完全一致：

| 环境 | 前端 | 后端 |
|---|---|---|
| 本地直接启动 | `3001` | `3000` |
| Docker / docker compose | `3001:3001` | `3000:3000` |
| 服务器部署 | `3001` | `3000` |

前端浏览器 API 地址统一指向：

```txt
http://localhost:3000/api
```

Docker 内部服务间调用统一使用：

```txt
http://backend:3000/api
```

环境文件当前应保持：

- 根目录 [.env](file:///c:/Users/user/Desktop/播放器/.env)
- 根目录 [.env.local](file:///c:/Users/user/Desktop/播放器/.env.local)
- 后端 [backend/.env](file:///c:/Users/user/Desktop/播放器/backend/.env)

关键配置：

```txt
PORT=3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

### 3.1 生产环境（线上）口径

线上服务器：`/root/player`，公网 IP `150.158.122.193`，Docker Compose + 腾讯云 COS。

| 入口 | 地址 | 说明 |
|---|---|---|
| 主站（唯一业务入口） | `https://nxhguitar.com` | 前端容器 `3001`，Nginx 反代 |
| API | `https://api.nxhguitar.com/api` | 后端容器 `3000`，Nginx 反代 |
| `http://nxhguitar.com` | 301 → `https://nxhguitar.com` | 只做跳转 |
| `http://` / `https://www.nxhguitar.com` | 301 → `https://nxhguitar.com` | 只做跳转 |

约定：

- 只保留 `https://nxhguitar.com` 一个业务 Origin；`www`、HTTP 一律 301 跳主站，避免登录态 / CORS / localStorage 分裂。
- 证书由 Certbot（Let's Encrypt）签发并自动续期，覆盖 `nxhguitar.com`、`www`、`api` 三个域名。
- 生产环境变量（`/root/player/.env`，同时需要同步到 `/root/player/backend/.env`）：

```env
FRONTEND_URL=https://nxhguitar.com
NEXT_PUBLIC_API_BASE_URL=https://api.nxhguitar.com/api
CI_CALLBACK_SECRET=<数据万象回调密钥，见第 17 节>
```

- `NEXT_PUBLIC_API_BASE_URL` 是**前端构建时变量**，改完必须 `build frontend` 重建，否则浏览器仍用旧 API 地址。
- 云端 COS 桶 `gy-nodejs-study-1423556188` 的 CORS 必须放行 `https://nxhguitar.com`（改域名 / 上 HTTPS 后都要同步）。
- 站点元数据标题（`frontend/app/layout.js`）为：`能学慧吉他课堂笔记整理工具`。

部署、HTTPS 申请、Nginx、CORS、故障排查的完整记录见：

- [debug复盘/2026-09-20-服务器部署问题复盘.md](file:///c:/Users/user/Desktop/播放器/debug复盘/2026-09-20-服务器部署问题复盘.md)

### 3.2 服务器更新代码的标准流程

```bash
cd /root/player
git pull gitee main

# 只改前端
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml build frontend
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml up -d --force-recreate frontend

# 只改后端
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml build backend
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml up -d --force-recreate backend
```

改了 `.env`、`NEXT_PUBLIC_API_BASE_URL`、后端配置或后端依赖时，对应的镜像必须重建，只 `restart` 不生效。

---

## 4. 样式架构与 CSS Module 规则

这是当前接手最容易踩坑的地方。

### 4.1 全局样式职责

全局样式分两层：

- [design-system.css](file:///c:/Users/user/Desktop/播放器/frontend/app/design-system.css)
  - 设计 token。
  - 公共设计系统类。
  - 跨页面复用结构：导航、卡片、网格、分页、弹层、格纹背景等。
- [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css)
  - 只保留最小 reset。
  - 不要继续往里面堆页面样式。

### 4.2 新页面样式必须用 CSS Module

M6 收尾后已经明确：

- 新页面私有样式使用 `*.module.css`。
- 不要把页面私有样式继续追加进 [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css)。
- 如果某个样式只服务单页，就放到该页同目录 CSS Module。
- 如果某个样式跨多个 PRD 页面复用，才考虑放进 [design-system.css](file:///c:/Users/user/Desktop/播放器/frontend/app/design-system.css)。

已经使用 CSS Module 的页面包括：

- [login.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/login/login.module.css)
- [home.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/home.module.css)
- [my-homework.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/my-homework/my-homework.module.css)
- [library.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/library/library.module.css)
- [library-book.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/library/[id]/library-book.module.css)
- [admin-library.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/library/admin-library.module.css)
- [page.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/classes/page.module.css)

### 4.3 CSS Module 故障排查

后面还有很多模块依赖 CSS Module，因此不要用“组件内写 `<style>`”作为长期方案。

如果页面出现裸 HTML：

1. 先确认组件是否正确 `import styles from './xxx.module.css'`。
2. 确认 JSX 使用的 `styles.xxx` 在 CSS Module 中真实存在。
3. 确认没有被全局样式覆盖。
4. 如果代码没问题但 dev server 显示异常，重启前端。
5. 必要时删除 [frontend/.next](file:///c:/Users/user/Desktop/播放器/frontend/.next) 后重新 `npm run dev`。

登录页曾出现裸 HTML，最终应保持 CSS Module 方案，不应绕开模块样式体系。

---

## 5. 本地启动、重置与测试数据

### 5.1 启动依赖

本地依赖由 Docker 提供，通常包括 PostgreSQL 和 MinIO。先确保 Docker Desktop 已启动。

### 5.2 重置基础环境

```bash
cd backend
npm run test:reset
```

该脚本用于重置基础环境，当前会：

- DROP public schema 下旧表并重新建表。
- 清空对象存储桶。
- 执行 [ensureAppSchema](file:///c:/Users/user/Desktop/播放器/backend/src/db.js)。
- 初始化系统必需的基础账号 / 表结构。

注意：完整业务测试数据已迁移到 [test-data](file:///c:/Users/user/Desktop/播放器/test-data/) 独立目录维护，不再把 README 里的旧账号当作准。

### 5.3 注入 / 清理完整测试数据

```bash
cd test-data
node generate-assets.mjs
node seed.mjs
node clean.mjs
```

说明：

- `generate-assets.mjs` 生成封面、PDF、MP3 等静态素材。
- `seed.mjs` 新建普通教导主任、老师、学员、内容、图书馆、附件和作业历史。
- `clean.mjs` 按 `manifest.json` 精确清理 seed 生成的数据，不清理手工数据。
- 系统自带超级管理员不由测试数据注入，seed 不创建、不修改、不清理该账号。

详细测试数据说明见：

- [test-data/README.md](file:///c:/Users/user/Desktop/播放器/test-data/README.md)
- [test-data/TEST_ACCOUNTS.md](file:///c:/Users/user/Desktop/播放器/test-data/TEST_ACCOUNTS.md)

### 5.4 启动后端

```bash
cd backend
$env:PORT='3000'; npm start
```

健康检查：

```txt
http://localhost:3000/api/health
```

### 5.5 启动前端

```bash
cd frontend
$env:PORT='3001'; npm run dev
```

如果出现 Next dev 缓存错误，例如：

- `.next/server` 缺 chunk
- React Client Manifest 找不到模块
- `__webpack_modules__[moduleId] is not a function`
- 页面 HTML 已更新但 CSS Module 不生效

处理方式：停止前端 dev server，删除 `frontend/.next`，再重新启动前端。

---

## 6. 测试账号

测试数据账号以 [test-data/TEST_ACCOUNTS.md](file:///c:/Users/user/Desktop/播放器/test-data/TEST_ACCOUNTS.md) 为准；登录页左侧也有一个临时“测试账号”提示卡片，代码里已标注后续上线 / 交付前可整块删除。

当前所有演示账号密码统一为：

```txt
demo123
```

常用账号：

| 身份 | 登录账号 | 内部测试标识 | 昵称 | 来源 | 密码 |
|---|---|---|---|---|---|
| 初始超级管理员 | `admin` | `admin` | admin | 系统初始化 `ensureAppSchema` 仅在无超管时创建 | `demo123` |
| 普通教导主任 / 普通管理员 | `13900000002` | `dean_yuhan` | 教务雨涵老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000011` | `teacher_luxiang` | 鲁祥老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000012` | `teacher_yuanyuan` | 缘缘老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000013` | `teacher_zhangning` | 张宁老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 内部测试学员 | `13776186160` / `13013811119` / `18362776877` / `13382800426` | `internal_student_yuhan` / `internal_student_luxiang` / `internal_student_zhangning` / `internal_student_yuanyuan` | 学生雨涵 / 学生鲁详 / 学生张宁 / 学生缘缘 | `test-data/seed.mjs` 注入（能学慧内部测试班，账号表置顶） | `demo123` |
| 学员 | `13800001001` ~ `13800001016` | `test_student_01` ~ `test_student_16` | 见账号表 | `test-data/seed.mjs` 注入 | `demo123` |

口径说明：

- 普通教导主任、老师、学员的产品登录账号优先使用手机号 / 纯数字账号。
- 初始超级管理员账号是 `admin`，不由 `test-data` 注入。启动初始化只在**库中不存在任何 `super_admin`** 时创建它；如果已经存在超管（无论是否改过密码），启动过程不覆盖、不改密码。
- `username = admin` 且 `role = super_admin` 的默认超管账号**禁止删除**，接口会返回「默认教导主任账号不可删除」。
- `seed.mjs` 只负责注入普通教导主任、老师、学员和业务测试数据；`clean.mjs` 按 `manifest.json` 精确清理 seed 数据，不清理初始超级管理员。
- 当前处于内部试用阶段：请重点验证老师布置作业、学生历史记录、学生学习首页、作业提交与查看；不要一次上传太多正式文件，正式上线前会清空测试数据重建。

登录页：

```txt
http://localhost:3001/login
```

游客入口应进入 `/tracks`。

---

## 7. 当前阶段状态

M0–M9 均已完成，当前进入整体回归修 bug 阶段。

### 已完成里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 | 已完成 | 清理、初始化、新表结构、重置测试环境 |
| M1 | 已完成 | 权限基础设施、停用账号、前置关系、媒体关联 |
| M2 | 已完成 | 设计系统基建、AppNav、ContentCard、公共组件 |
| M3 | 已完成 | 曲目区、曲谱集、曲目详情、曲谱集详情、曲目后台创建 |
| M4 | 已完成 | 知识点区、知识点集、知识点详情、知识点后台创建 |
| M5 | 已完成 | 作业推送扩展，支持合集、单对象、单 P |
| M6 | 已完成 | 权限页面、停用账号行为、班级管理、弹层交互、样式架构收尾 |
| M7 | 已完成 | 图书馆、PDF 详情、后台 PDF 上传、关联资料展示 |
| M8 | 已完成 | 学员首页、我的历史作业、停用学员文案和历史快照 |
| M9 | 已完成，正在回归修 bug | 清理旧页面、退役旧 `/videos` 前端页面、逐页对照设计稿修复 |

### 当前重点

当前工作重点：

- 按 HTML 设计稿逐页比对。
- 修复视觉偏差。
- 修复角色差异。
- 修复页面跳转、编辑、删除、悬停操作等 bug。
- 清理旧“视频播放器”残留。
- 使用 `test-data` 大体量数据回归：20 单曲 / 5 曲谱集、20 单知识点 / 5 知识点集、多附件、图书馆继承关联并集、8 天作业历史。

不要随意发明 UI。设计稿有角色预览时，必须按角色预览实现。

### 最近状态补充

- 曲目区 / 知识点区首页已按一屏布局收敛：合集超过 1 行分页，单课 / 单知识点超过 2 行分页，页面使用 `body.library-index-page` 锁定高度避免整页滚动。
- 新建单曲目、单知识点、曲谱集、知识点集成功后会直接跳到对应详情页。
- 登录页已新增左侧独立测试账号卡片；管理员登录文案使用“用户名 / 账号”，显示密码按钮使用内联 SVG，避免图标偶发消失。
- 头像下拉菜单已修复 hover 断层，鼠标从头像移到菜单不会立即消失。
- 学员管理 / 班级管理已把当前选择同步到 URL 参数，刷新后应恢复到原学员 / 原班级。
- 学员管理会保存学生列表和历史列表滚动位置，刷新或切换后尽量恢复原滚动位置。
- 学员管理列表单击学生卡片即可选中，不需要双击。
- 学员管理页仅保留“标记学生”和作业相关操作；重置密码、停用 / 恢复、删除等账号管理操作统一放在班级管理页。
- 老师端和学生端历史作业均按推送时标题快照展示，历史记录不再作为跳转入口；搜索支持标题、练习要求、提交要求。老师端历史区有“回到顶部”。
- 站点元数据标题已改为 `能学慧吉他课堂笔记整理工具`（`frontend/app/layout.js`），不是导航栏名称。
- 公安备案审核期间的临时配置（未登录首屏游客曲目区、登录页审核提示）**已全部恢复**，现在未登录访问 `/` 会正常跳转 `/login`。相关记录见 [debug复盘/2026-09-29-公安备案审核临时配置说明.md](file:///c:/Users/user/Desktop/播放器/debug复盘/2026-09-29-公安备案审核临时配置说明.md)。
- 视频播放器控制栏已重构为：`上一P` / 播放暂停 / `下一P` / 进度条 / 时间 / 画质 / 倍速 / 全屏。上一P、下一P 由详情页传入，切换的是当前曲目 / 知识点的 P，不会跨对象跳转。
- 图书馆详情页已修复被全局样式撑高的拉伸问题，图书馆列表翻页器也已统一为与知识点区一致的样式，见第 9 节。
- 正在接腾讯云数据万象（CI）自动转码：曲目 / 知识点 P 上传后自动产出 720p、1080p 两档，播放器画质菜单可切换，详见第 17 节。

---

## 8. 测试数据覆盖范围

完整测试数据位于 [test-data](file:///c:/Users/user/Desktop/播放器/test-data/)：

- 账号：1 个普通教导主任、3 个老师、4 个常规测试班级 × 4 名学员 + 1 个「能学慧内部测试班」4 名内部测试学员；常规班级的第 3、8、13、16 名学员为停用状态。
- 曲目区：20 个单曲目 + 5 个曲谱集；单曲按 1~4 个 P 分布，部分单曲加入多个合集。
- 知识点区：20 个单知识点 + 5 个知识点集；单知识点按 1~4 个 P 分布，部分知识点加入多个合集。
- 附件：覆盖 MP3、JPG、PDF；曲目、曲目合集、知识点、知识点集均有样例附件，部分对象有多个附件。
- 图书馆：6 本 PDF 资料，分别关联单曲目、曲目合集、单知识点、知识点集。
- 并集测试：部分单曲 / 单知识点与其所属合集同时有关联图书馆资料，详情页应展示“直接关联 + 合集继承关联”的并集，不能漏项或重复。
- 作业历史：每名学员固定 8 天作业推送，日期为 `2026-09-10` ~ `2026-09-17`；每次推送 1~5 个内容，覆盖合集、单对象、具体分 P；同一视频可跨日期重复推送。
- 文案滚动：练习要求与提交要求均为超长文本，用于测试三行限制和内部滚动。

## 9. 最近已处理的回归问题

### 曲目区首页

文件：

- [tracks/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/tracks/page.js)
- [ContentCard.js](file:///c:/Users/user/Desktop/播放器/frontend/components/ui/ContentCard.js)
- [design-system.css](file:///c:/Users/user/Desktop/播放器/frontend/app/design-system.css)

已修复：

- 按 [tracks-home.html](file:///c:/Users/user/Desktop/播放器/docs/design/guitar-home/tracks-home.html) 恢复上下分区。
- 上区为曲谱集，下区为曲目。
- 教导主任新建按钮在各区块标题右侧，不在导航右侧。
- 卡片悬停显示查看详情 / 编辑 / 删除。
- 删除使用设计稿弹层，不用原生 `confirm`。
- 恢复下浓上淡的棕色格纹底图。
- 修复卡片操作按钮嵌套在整张 Link 里的结构问题。

### 知识点区首页

文件：

- [knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/page.js)
- [admin/knowledge/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/knowledge/page.js)

已修复：

- 按 [knowledge-home.html](file:///c:/Users/user/Desktop/播放器/docs/design/guitar-home/knowledge-home.html) 跑完和曲目库一致的流程。
- 上区为知识点集，下区为知识点。
- 教导主任新建按钮在各区块标题右侧。
- 卡片悬停显示查看详情 / 编辑 / 删除。
- 删除使用设计稿弹层。
- 修复知识点集编辑入口：`/admin/knowledge?type=collection&id=...` 会加载已有知识点集。

### 登录页

文件：

- [LoginForm.js](file:///c:/Users/user/Desktop/播放器/frontend/app/login/LoginForm.js)
- [login.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/login/login.module.css)

当前状态：

- 登录主卡片右侧展示，测试账号提示卡片在左侧独立展示，并带框内滚动。
- 测试账号卡片由 `TEMP_TEST_ACCOUNTS` 维护，代码注释已注明“上线或交付前删除”。
- 超管账号：`admin / demo123`；其余演示账号由 `test-data/seed.mjs` 注入。
- 登录表单文案使用“用户名 / 账号”，避免把初始超管误认为必须用手机号登录。
- 密码可见性按钮使用内联 SVG。

注意：登录页必须继续使用 CSS Module。曾经出现裸 HTML，多半与 CSS Module 映射 / dev 缓存 / M9 清理全局样式后的中间状态有关。不要改成组件内 `<style>` 长期方案。

### 学员管理 / 班级管理

文件：

- [admin/users/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/users/page.js)
- [admin/classes/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/classes/page.js)

当前状态：

- 学员管理刷新后通过 `?user=` 恢复选中学员；班级管理刷新后通过 `?class=` 恢复选中班级。
- 学员管理保存学生列表滚动和每个学员历史列表滚动，刷新后尽量回到原位置。
- 学员列表优先显示昵称，账号作为辅助信息。
- 选中学生使用单击；同步 URL 使用浏览器 history，不通过路由跳转打断选中状态。
- 学员管理页不再承担重置密码、停用 / 恢复、删除账号操作；这些账号操作统一在班级管理页处理。
- 学员历史作业支持按标题 / 练习要求 / 提交要求搜索，老师端历史区提供“回到顶部”。

### 图书馆区（详情页 + 翻页器）

文件：

- [library/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/library/[id]/page.js)
- [library/[id]/library-book.module.css](file:///c:/Users/user/Desktop/播放器/frontend/app/library/[id]/library-book.module.css)
- [library/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/library/page.js)

已修复：

- 详情页曾被全局 `.detail` 类污染导致排版错乱：页面外层改为使用 CSS Module 私有类 `styles.bookDetail`，不再复用全局 `.detail`。
- 详情页被 flex 拉伸：改为自然高度 —— `.bookDetail{align-items:start}`、`.binfo{min-height:0}`、`.bsec{flex:none}`，简介区固定 `max-height:140px` 内部滚动。
- 图书馆列表翻页器替换为与知识点区一致的数字分页（`‹ 1 2 3 … ›`）。

### 播放器控制栏

文件：

- [VideoPlayer.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoPlayer.js)
- [design-system.css](file:///c:/Users/user/Desktop/播放器/frontend/app/design-system.css)
- [tracks/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/tracks/[id]/page.js)
- [knowledge/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/knowledge/[id]/page.js)

当前状态：

- 控制栏顺序固定为：`上一P` → 播放 / 暂停 → `下一P` → 进度条 → 时间 → 画质 → 倍速 → 全屏。
- 已去掉此前无效的快进 / 快退按钮；上下 P 使用竖向分隔条 + 三角的内联 SVG，图标不再出现“奇怪”的观感。
- `VideoPlayer` 新增 `onPrev` / `onNext` 两个 prop，为空时按钮置灰不可点；由详情页计算相邻 P 并传入。
- 画质菜单来自 `renditions` prop（见第 17 节），无转码档位时只显示原画。
- 进度条与按钮间距在 `design-system.css` 的 `.vctrl` / `.pbar` / `.ibtn` 中统一，不要再单独塞回 `.seek-btn` 之类的一次性类。

---

## 10. 关键页面清单

当前逐页修 bug 应优先检查这些页面：

```txt
/login
/tracks
/tracks/:id
/tracks/collections/:id
/knowledge
/knowledge/:id
/knowledge/collections/:id
/library
/library/:id
/admin/tracks
/admin/tracks/collections
/admin/knowledge
/admin/users
/admin/classes
/admin/library
/
/my-homework
```

每个页面都要对照：

- PRD 角色权限。
- 对应 HTML 设计稿。
- 设计稿里的角色预览。
- AppNav 角色矩阵。

---

## 11. AppNav 角色矩阵

按 PRD §3：

| 角色 | 导航入口 |
|---|---|
| 游客 | 曲目区、知识点区、图书馆 |
| 学员 / user | 首页、曲目区、知识点区、图书馆、我的历史作业 |
| 老师 / teacher | 曲目区、知识点区、图书馆、学生管理 |
| 教导主任 / super_admin | 曲目区、知识点区、图书馆、学生管理、班级管理 |

游客不应看到作业记录 / 我的历史作业。

---

## 12. 作业推送关键规则

M5 已完成，后续修 bug 时不要破坏这些规则：

- 作业使用 `object_type / object_id / part_id`。
- 支持合集、单对象、单 P。
- 单 P 标题必须是：`单课名-P名` / `单知识点名-P名`。
- 分隔符是半角 `-`。
- 学员首页的“今日 / 当前作业”仍可作为学习入口，单 P 点击进入父详情页并带 `?part=`。
- 搜索 placeholder 必须是：`搜索合集 / 单课 / 单 P 名称…`
- 老师每次可给学生推送 1~5 个内容。
- 昨天推送过的视频 / 内容，今天仍可继续推送，不受历史记录影响。
- 删除作业 / 历史记录必须填写原因。
- 老师只能推送给自己班级里的学员，后端必须强校验。
- 老师端 / 学生端历史作业必须使用推送时标题快照：优先 `assigned_object_title`，再用 `assigned_video_title`，缺失时显示“已删除内容”。
- 历史作业页只做记录浏览，不做内容跳转；视频或内容被删除后，历史标题仍必须保留。
- 历史作业搜索范围包括：推送内容标题、练习要求、提交要求。
- 新作业字段使用 `practice_requirement`、`submit_requirement`；旧 `message` 仅保留历史兼容，不作为新页面输入。

---

## 13. 旧实现与清理注意事项

旧前端 `/videos` 页面应视为已退役方向。不要继续开发旧视频首页。

保留但不要误删：

- [VideoPlayer.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoPlayer.js)
  - 这是曲目 P / 知识点 P 的复用播放器组件。
- [uploadVideo.js](file:///c:/Users/user/Desktop/播放器/frontend/components/uploadVideo.js)
  - 这是 P 分段上传 helper。
- [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js)
  - 后端视频上传、存储、清晰度、转码基础设施仍被 P 分段使用。

不要把“旧 `/videos` 前端页面”与“仍需要的视频基础能力”混为一谈。

---

## 14. 开发纪律

1. 每次开工先读 PRD 对应章节和设计稿。
2. 前端页面必须逐块对照设计稿，不接受“风格接近”。
3. 设计稿里有角色预览，就必须核对不同角色显示差异。
4. 注意：CSS 数学函数里不能照抄 `min(..., 1fr)`。`1fr` 不能出现在 `min()` 内，会导致浏览器丢弃整条声明并破坏布局；详情页两列布局应使用 `minmax(0, calc(...)) 260px`。
5. 不要自己发明 UI、文案、按钮位置。
6. 新页面私有样式用 CSS Module。
7. 不要继续往 [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css) 堆页面样式。
8. 跨页面复用样式才放 [design-system.css](file:///c:/Users/user/Desktop/播放器/frontend/app/design-system.css)。
9. 不要重写分片上传，调用 [uploadVideo.js](file:///c:/Users/user/Desktop/播放器/frontend/components/uploadVideo.js) 现有能力。
10. 不要修改 [storage.js](file:///c:/Users/user/Desktop/播放器/backend/src/storage.js) 的核心对象存储流程，除非 PRD 明确要求。
11. 不要做旧数据迁移，测试环境清空重建。
12. 写接口必须后端鉴权，前端隐藏入口不算安全。
13. 后续启动端口固定：后端 `3000`，前端 `3001`。
14. 涉及服务器部署、生产 COS、生产环境变量、线上端口和反向代理配置时，不要凭猜测改 README 或配置；必须以当前部署文档 / 运维确认信息为准。

---

## 15. 快速验证清单

后端健康检查：

```txt
http://localhost:3000/api/health
```

前端页面：

```txt
http://localhost:3001/login
http://localhost:3001/tracks
http://localhost:3001/knowledge
http://localhost:3001/library
http://localhost:3001/admin/tracks
http://localhost:3001/admin/knowledge
http://localhost:3001/admin/users
http://localhost:3001/admin/classes
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
GET /api/library
POST /api/auth/login
POST /api/admin/login
```

---

## 16. 线上运维速查

服务器：`/root/player`（Docker Compose，项目名 `video_player`）。

容器与日志：

```bash
cd /root/player
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml ps
docker logs --tail=150 video_player_backend
docker logs --tail=150 video_player_frontend
```

健康检查与域名验证：

```bash
curl http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1:3001
curl -I https://nxhguitar.com
curl -I https://www.nxhguitar.com
curl https://api.nxhguitar.com/api/health
```

Nginx：

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo tail -n 100 /var/log/nginx/error.log
```

数据库：

```bash
docker exec -it video_player_postgres psql -U postgres -d video_player -c "\dt"
docker exec -it video_player_postgres psql -U postgres -d video_player -c "SELECT COUNT(*) FROM track_points;"
```

端口占用：

```bash
sudo ss -tnlp | grep -E ':80|:3000|:3001'
docker ps --filter publish=3000 --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}"
```

完整排障手册（DNS、Certbot、CORS、端口冲突、www 跳转）：

- [debug复盘/2026-09-20-服务器部署问题复盘.md](file:///c:/Users/user/Desktop/播放器/debug复盘/2026-09-20-服务器部署问题复盘.md)

---

## 17. 视频清晰度与自动转码（腾讯云数据万象 CI）

### 17.1 目标与现状

- 每个 P（曲目 P / 知识点 P）上传后自动产出 **720p / 1080p** 两档，播放器画质菜单可切换，默认优先 1080p。
- 前端播放器是原生 `<video>` **直接播 MP4**，没有接 hls.js，因此**只使用 MP4 转码模板，不要选 HLS 系列**（选了也播不了，需要先改造前端）。
- 数据模型沿用现有表，**不需要新建表**：
  - `videos`：统一视频实体，曲目 P、知识点 P 都指向它（`track_parts.video_id` → `videos.id`）。
  - `video_renditions`：`source` / `720p` / `1080p` 三档，上传时预置 `processing` 状态。

### 17.2 数据流

```txt
前端分片上传
  -> COS: tracks/<曲目id>/<uuid>.mp4 或 knowledge/<知识点id>/<uuid>.mp4
  -> CI 工作流（输入路径 tracks/ 或 knowledge/）自动触发
  -> 输出: transcoded/720p/${InputName}_720p.mp4、transcoded/1080p/${InputName}_1080p.mp4
  -> CI 回调: POST https://api.nxhguitar.com/api/videos/transcode/callback?token=<CI_CALLBACK_SECRET>
  -> 后端解析 TaskFinish 报文 -> 源文件 key 反查 videos.id -> 写 video_renditions 对应档位为 ready + 转码地址
```

### 17.3 控制台配置要点（两个工作流）

| 项目 | tracks 工作流 | knowledge 工作流 |
|---|---|---|
| 输入路径 | `tracks/` | `knowledge/` |
| 输出目录 | `transcoded/720p/`（720p 节点）、`transcoded/1080p/`（1080p 节点） | 同左 |
| 输出文件名 | `${InputName}_720p.${ext}` / `${InputName}_1080p.${ext}` | 同左 |
| 模板 | H264-MP4-高清（1280px）/ H264-MP4-全高清（1920px） | 同左 |
| 回调 | 自定义回调配置 + HTTP 回调，格式 **JSON**，只勾「任务完成回调」 | 同左 |

必须注意：

- 输入路径**结尾必须带斜杠**（`tracks/`）；**留空表示整桶生效**，会把封面、附件和转码产物一起卷进来，形成循环转码刷费用。
- 转码节点的目标路径**必须从默认的 `${InputPath}` 改掉**，否则结果写回 `tracks/` / `knowledge/`，自己触发自己。
- `${RunId}` 是工作流实例 ID，同一工作流的两个转码节点共用同一个值，所以两个节点**不能**用同一个输出文件名，否则互相覆盖。
- 两个节点都关闭「闲时转码」（闲时资源最长 72 小时才处理，教学场景等不起）；倍速转码、水印保持关闭。
- 工作流默认关闭，保存后需**启用**，约 5 分钟生效；**启用状态下不能编辑**，要改先暂停。
- 存量视频不会自动转码，需要在工作流里用「测试 / 创建执行实例」手动触发，可分批做。

### 17.4 后端实现位置

| 文件 | 职责 |
|---|---|
| [transcode.js](file:///c:/Users/user/Desktop/播放器/backend/src/transcode.js) | `parseCiCallbackPayload` 解析 TaskFinish 报文；`resolveTranscodeQuality` 按产物路径 / 画面长边判定档位（竖屏也能判对）；`findVideoIdBySourceKey` 用源 key 反查 `videos.id`；`verifyCiCallbackRequest` 校验回调身份 |
| [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js) | `POST /api/videos/transcode/callback`：验签 → 解析 → 反查 → 写档位状态；失败写 `failed`，回调一律返回 200 避免 CI 反复重试 |
| [storage.js](file:///c:/Users/user/Desktop/播放器/backend/src/storage.js) | `publicKeyPrefixes` 已加入 `transcoded/`，转码产物才能生成公开地址 |

回调安全策略（重要）：

- 密钥来自环境变量 `CI_CALLBACK_SECRET`（服务器根目录 `/root/player/.env`；`docker-compose.yml` 的 backend 用这个文件；本地直接跑后端时读 `backend/.env`）。
- **未配置密钥时回调接口一律拒绝**（返回 503），不会像旧实现那样「没配密钥就放行」——那个写法等于任何人构造一个 POST 就能伪造回调。
- 回调 URL 用 `?token=<CI_CALLBACK_SECRET>` 传密钥（CI 控制台没有密钥配置项）；另保留 HMAC 签名头校验分支备用。
- 额外两道防御：产物 key 必须以 `transcoded/` 开头；并用 HeadObject 确认产物确实存在（只有 404 才拒绝，网络抖动类异常放行不丢结果）。

配好后验证：在工作流手动跑一个 `tracks/` 下的小视频，后端日志会出现 `[ci-callback] { state, inputKey, outputKey, quality }`，桶里应出现 `transcoded/720p/` 与 `transcoded/1080p/` 两个文件，播放页画质菜单能看到并切换 720P / 1080P。

控制台逐步操作指南与交接说明：

- [debug复盘/2026-10-01-腾讯云数据万象转码接入操作指南.md](file:///c:/Users/user/Desktop/播放器/debug复盘/2026-10-01-腾讯云数据万象转码接入操作指南.md)

---

## 18. 近期变更记录

| 日期 | 内容 |
|---|---|
| 2026-09-29 | 完成 HTTPS 域名部署（`https://nxhguitar.com` 唯一业务入口，www / HTTP 301 跳转），流程写入部署复盘 |
| 2026-09-29 | 公安备案审核临时配置（未登录游客视图 + 登录页审核提示） |
| 2026-10-01 | 公安备案通过，临时配置全部恢复，未登录正常跳转 `/login` |
| 2026-10-01 | 新增腾讯云数据万象转码接入操作指南 |
| 2026-10-03 | 播放器控制栏改为 上一P / 播放 / 下一P 布局；默认超管仅在无超管时创建且禁止删除；`prerequisites` 视频封面字段改用 `cover_url` 修复详情页 500；实现数据万象转码回调（真实报文解析 + 回调密钥校验 + `transcoded/` 公开地址） |
