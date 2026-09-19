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
| 初始超级管理员 | `admin` | `admin` | admin | 系统初始化 `ensureAppSchema` 自动保留 | `demo123` |
| 普通教导主任 / 普通管理员 | `13900000002` | `dean_yuhan` | 教务雨涵老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000011` | `teacher_luxiang` | 鲁祥老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000012` | `teacher_yuanyuan` | 缘缘老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 老师 | `13900000013` | `teacher_zhangning` | 张宁老师 | `test-data/seed.mjs` 注入 | `demo123` |
| 学员 | `13800001001` ~ `13800001016` | `test_student_01` ~ `test_student_16` | 见账号表 | `test-data/seed.mjs` 注入 | `demo123` |

口径说明：

- 普通教导主任、老师、学员的产品登录账号优先使用手机号 / 纯数字账号。
- 初始超级管理员账号是 `admin`，不由 `test-data` 注入；建表初始化只保留这个系统必需账号，不再写入 `teacher_a`、`student_a1` 这类测试账号。
- `seed.mjs` 只负责注入普通教导主任、老师、学员和业务测试数据；`clean.mjs` 按 `manifest.json` 精确清理 seed 数据，不清理初始超级管理员。

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

---

## 8. 测试数据覆盖范围

完整测试数据位于 [test-data](file:///c:/Users/user/Desktop/播放器/test-data/)：

- 账号：1 个普通教导主任、3 个老师、4 个班级 × 4 名学员；第 3、8、13、16 名学员为停用状态。
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
