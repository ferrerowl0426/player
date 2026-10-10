# test-data — 测试初始数据包（独立文件夹，不碰业务代码）

> 本包按当前 PRD 准备：账号、班级、内容、图书馆资料、附件、作业历史和可清理脚本都集中在本目录；不需要 DOCX。

> 位置：`播放器/test-data/`，与 `backend/`、`frontend/` 平级。
> 依赖：复用 `backend/node_modules` 与 `backend/.env`，**本项目不需要安装任何新依赖，不改动任何业务代码**。
> 前置：本地 Docker 栈已启动（Postgres `localhost:15432` + MinIO `localhost:9000`），后端至少启动过一次（账号由 `ensureAppSchema` 自动创建）。

## 账号（密码统一为 `demo123`）

| 角色 | 手机号/登录账号 | 内部测试标识 | 密码 | 说明 |
|------|----------|------|------|------|
| 普通教导主任 | `13900000002` | `dean_yuhan` | demo123 | 教务雨涵老师；可管理内容与班级 |
| 老师 | `13900000011` / `13900000012` / `13900000013` | `teacher_luxiang` / `teacher_yuanyuan` / `teacher_zhangning` | demo123 | 鲁祥老师 / 缘缘老师 / 张宁老师 |
| 内部测试学员 | `13776186160` / `13013811119` / `18362776877` / `13382800426` | `internal_student_yuhan` / `internal_student_luxiang` / `internal_student_zhangning` / `internal_student_yuanyuan` | demo123 | 能学慧内部测试班；在账号表中置顶展示 |
| 学员 | `13800001001` ~ `13800001016` | `test_student_01` ~ `test_student_16` | demo123 | 4 个测试班级，每班 4 人；含停用学员 |

> 系统自带超级管理员不由测试数据注入，也不会被 seed 修改；本包只新建普通教导主任、老师和学员测试账号，clean 会按 manifest 删除。

## 内容清单

**曲目区**：20 个单曲目 + 5 个曲谱集；单曲随机/规律出现 1~4 个分 P，部分单曲加入多个合集，覆盖“单曲直接资料 + 所属合集继承资料”的并集展示。

**知识点区**：20 个单知识点 + 5 个知识点集；单知识点随机/规律出现 1~4 个分 P，部分知识点加入多个合集，覆盖“单知识点直接资料 + 所属合集继承资料”的并集展示。

**前置关系**：晴天 ← 卡农（单曲目）；卡农 ← 1645（单知识点）；1645 ← 指弹基础知识点（知识点集）。

**视频清晰度**：前 5 个视频有 source/1080p/720p 三档（ready，可切菜单）；「击弦与勾弦技巧 P1」只有 source（测"只列已上传档位"）。样例视频为公网 CC0 短视频（flower/friday/sample-5s，约 5~10 秒）。

**附件**：曲目、曲目合集、知识点、知识点合集均有样例附件，覆盖 MP3、JPG、PDF；部分对象拥有多个附件。

**图书馆**：6 本 PDF，分别关联单曲、曲目合集、单知识点、知识点合集；部分单科/单曲和其所属合集同时有关联资料，用于验证详情页是否展示直接关联与合集继承关联的并集。PDF 为脚本生成的单页示例文档。

**作业与学习记录**：每名学员固定 8 天作业推送，时间固定在 `2026-09-10` ~ `2026-09-17`（全部早于 9.18）；每次推送包含 1 ~ 5 个内容，覆盖合集、单曲目/单知识点、具体分 P，且同一视频可在不同日期重复推送，不受历史记录影响；含软删除痕迹、超长文本滚动排版和练习要求 / 提交要求两个独立字段。停用学员也保留历史数据，用于验证历史记录展示。

- 额外新增“能学慧内部测试班”4 名内部测试学员：学生雨涵、学生鲁详、学生张宁、学生缘缘，账号表中置顶展示。
- 4 个常规测试班级，每班 4 名学员，共 16 名；第 3、8、13、16 名为停用状态。另有 1 个“能学慧内部测试班”，包含 4 名内部测试学员。
- 每名学员都有 8 次作业推送历史；每次推送使用同一个 `operation_id` 聚合 1 ~ 5 条作业明细。
- 2 条历史推送为软删除，保留删除原因和时间。
- 所有记录使用超长练习要求与提交要求文案，专门测试换行、三行限制和内部滚动。
- 所有记录均使用 `practice_requirement`、`submit_requirement` 独立字段；旧 `message` 不作为新数据输入。
- 曲目/知识点详情页重点回归：直接关联图书馆资料 + 所属合集继承资料需要取并集，不能漏项、不能重复。

## 内部测试提醒

当前阶段主要希望大家熟悉功能、帮助验证流程，请重点测试老师布置作业、历史记录、学生学习首页、作业提交与查看等功能。请不要一次性上传太多正式文件；正式上线前会清空全部测试数据重新开始。

## 使用

```bash
cd test-data

# 1. 生成静态资源（首次已执行过；想重新生成封面/PDF 时用）
node generate-assets.mjs

# 2. 播种（上传文件到 MinIO + 写库）
node seed.mjs

# 3. 清除全部测试数据（按 manifest.json 精确删除，不影响你手工创建的数据）
node clean.mjs
```

### 服务器宿主机执行

服务器代码目录是 `/root/player`，测试数据脚本在宿主机目录中，不在 backend 容器镜像里。因此不要进入 backend 容器执行 `node clean.mjs`。

```bash
cd /root/player/test-data
node clean.mjs
```

脚本会通过 `runtime-config.mjs` 自动读取根目录 `.env` 和 `backend/.env`，并兼容 `DATABASE_URL`、`DB_*`、`PG*` 变量。

如果服务器根目录 `.env` 不适合宿主机直接连接数据库，可显式覆盖连接串。本项目当前 compose 将 PostgreSQL 映射为 `15432:5432`，宿主机端口应使用 `15432`：

```bash
cd /root/player/test-data
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:15432/video_player' node clean.mjs
```

如果要先确认真实数据库名和映射端口：

```bash
cd /root/player
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml ps
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml exec postgres psql -U postgres -d postgres -c '\l'
```

## 文件结构

```txt
test-data/
├── generate-assets.mjs   # 纯 Node 生成封面 PNG（1:1）与示例 PDF，零依赖
├── seed.mjs              # 播种：上传 + 写库，产出 manifest.json
├── clean.mjs             # 清除：按 manifest 精确删库 + 删 COS 对象 + 还原密码
├── manifest.json         # 播种产物（clean 的删除依据，勿手动编辑）
└── assets/
    ├── sample-a.mp4 / friday.mp4 / sample-5s.mp4   # 公网 CC0 样例视频
    ├── covers/          # 8 张网络封面 + 1 张附件图
    └── docs/            # 3 份示例 PDF + 1 份示例 MP3
```

## 设计说明

- **可删除性**：seed 把所有插入的 id、上传的 COS key、改过密码的账号全部记进 `manifest.json`，clean 按清单**精确删除**——不会碰你自己手工建的曲目/资料/作业
- **COS 隔离**：所有对象都在 `test-data/` 前缀下，且库里存的是完整公开 URL（与真实上传一致，`normalizePublicUrl` 原样放行）
- **PDF 预览**：测试 PDF 上传时写入 `Content-Disposition: inline`，用于网页端新窗口预览；音频和其他附件只保留下载入口
- **幂等保护**：manifest.json 存在时 seed 会拒绝重复执行，先 clean 再 seed
- **超级管理员不注入**：系统自带超级管理员由业务初始化流程提供，seed 不创建、不修改、不清理该账号
- 样例视频源：assets 内已准备的短视频文件；封面和 PDF 均随包提供，不依赖运行时联网
