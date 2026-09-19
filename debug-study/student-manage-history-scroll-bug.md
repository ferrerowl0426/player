# 学员管理页历史作业栏滚动失效 Bug 复盘

## 1. 问题现象

学员管理页 `/admin/users` 在修复多轮后仍出现以下问题：

1. **历史作业栏会随着记录数量无限向下延展**  
   用户期望的是：历史作业区域本身固定在页面中，内部时间轴滚动查看更多历史记录。  
   实际表现是：历史记录越多，中间栏越高，页面整体被撑开。

2. **历史作业内部滚动没有真正生效**  
   虽然 `.rec-list` 已经写了 `overflow-y: auto`，但滚动容器没有得到稳定高度，所以滚动条件不成立。

3. **初始框只有屏幕一半高度**  
   在历史记录较少或初始状态下，中间面板没有撑满视口可用高度，而是退化成按内容高度显示。

4. **多次补内部 flex 链路无效**  
   先后补过 `.cols`、`.main`、`.history-zone`、`.rec-list` 的 `min-height: 0` / `height: 0` / `overflow`，但线上仍不符合预期。

---

## 2. 用户真实需求

用户明确的需求是：

> 历史作业这一栏不要无限向下延展；历史作业栏内部自己滚动。  
> 初始框也不应该只有屏幕一半高度，而应该是稳定的三栏页面布局。

准确拆解为：

- 页面保持三栏管理后台布局；
- 中间「历史作业」面板高度稳定；
- 面板头部、学员摘要等固定；
- 历史记录列表 `.rec-list` 占据剩余空间；
- 记录多时 `.rec-list` 内部滚动；
- 记录少时 `.rec-list` 仍占据剩余空间，不让整个面板塌陷。

---

## 3. 误判与绕路

### 3.1 一开始误以为是内部高度链不完整

前面多轮修复主要集中在：

```css
.cols { flex: 1; min-height: 0; }
.main { flex: 1 1 0; min-height: 0; overflow: hidden; }
.history-zone { flex: 1 1 0; min-height: 0; height: 0; overflow: hidden; }
.rec-list { flex: 1 1 0; min-height: 0; height: 0; overflow-y: auto; }
```

这些写法本身是 flex 内部滚动常见写法，方向并没有错。

但它们有一个前提：**父级必须先有一个确定高度**。  
如果根容器高度本身没有成立，内部再怎么补 `height: 0` 和 `overflow-y: auto` 都不会真正生效。

### 3.2 一度怀疑缓存或旧容器

因为源码里看起来已经有完整滚动链，但截图仍是旧表现，所以排查过：

- 线上 HTML；
- 线上 CSS chunk；
- 线上 JS chunk；
- CSS / JS 哈希是否一致；
- 是否包含「上次作业」按钮；
- HTTP 缓存头是否 no-cache。

最终确认：

- 浏览器拿到的是最新构建；
- CSS / JS 是同一版本；
- 「上次作业」按钮已经在线上；
- 响应头也有 `no-store, no-cache`；
- 所以不是缓存问题，也不是旧容器问题。

---

## 4. 最终根因

最终定位到根节点规则：

```css
.studentManage:global(.student-manage) {
  flex: 1 1 0;
  height: calc(100dvh - 56px);
  min-height: 0;
  ...
}
```

问题在于：

- 学员页根节点 `<main>` 是 `body` 这个 flex 容器的子项；
- `flex: 1 1 0` 中的 `flex-basis: 0` 会参与 flex 布局分配；
- 在当前页面中，为了锁定页面滚动，`body.student-manage-page` 又把 body 的高度体系压得很紧；
- 结果是：根节点声明了 `height: calc(100dvh - 56px)`，但实际布局中被 `flex-basis: 0` 干扰，根容器没有稳定拿到这个视口高度；
- 根容器高度不成立，下面 `.cols → .main → .history-zone → .rec-list` 的高度链就全部失去基础。

也就是说，真正断掉的不是 `.rec-list`，而是最外层根容器。

一句话根因：

> 根容器同时写了 `flex: 1 1 0` 和 `height: calc(100dvh - 56px)`，其中 `flex-basis: 0` 破坏了根容器的稳定视口高度，导致内部滚动链没有可继承的高度。

---

## 5. 最终修复

只做一处关键修改：

```diff
-.studentManage:global(.student-manage){ flex: 1 1 0; height: calc(100dvh - 56px); min-height: 0;
+.studentManage:global(.student-manage){ flex: none; height: calc(100dvh - 56px); min-height: 0;
```

含义：

- 不再让根节点参与 `body` 的 flex 剩余空间分配；
- 让 `height: calc(100dvh - 56px)` 成为根容器明确高度；
- 由这个确定高度向下支撑三栏布局；
- `.rec-list` 的 `overflow-y: auto` 才真正有可滚动的固定容器。

---

## 6. 修复后的关键布局链路

修复后正确链路应为：

```text
main.student-manage
  height: calc(100dvh - 56px)
  overflow: hidden
  ↓
.cols
  flex: 1
  min-height: 0
  ↓
.main / .aside / .side
  min-height: 0
  overflow: hidden
  ↓
.history-zone
  flex: 1
  min-height: 0
  overflow: hidden
  ↓
.rec-list
  flex: 1
  min-height: 0
  height: 0
  overflow-y: auto
```

重点：

- `height: 0` 只应该用于 flex 子级的“剩余空间滚动区”；
- 根容器不能用 `flex-basis: 0` 去抢 `height` 的控制权；
- 外层固定高度，内层剩余空间滚动，这两件事必须分清。

---

## 7. 验证方式

本次修复后执行过：

```bash
git diff --check -- frontend/app/admin/users/page.module.css
```

Docker 构建与部署：

```bash
docker compose -p video_player -f "C:\Users\user\Desktop\播放器\docker-compose.yml" build frontend
docker compose -p video_player -f "C:\Users\user\Desktop\播放器\docker-compose.yml" up -d frontend
```

线上验证：

- `/admin/users` 返回 HTTP 200；
- `/api/health` 返回后端健康；
- 新 CSS chunk 中确认包含：

```css
flex:none;height:calc(100dvh - 56px)
```

以及 `.rec-list` 的内部滚动规则：

```css
.rec-list {
  flex: 1 1;
  min-height: 0;
  height: 0;
  overflow-y: auto;
}
```

---

## 8. 经验教训

### 8.1 内部滚动失效时，不要只盯着滚动容器

当 `overflow-y: auto` 不生效时，常见原因不是这一行没写，而是：

- 父级没有固定高度；
- flex 父级缺 `min-height: 0`；
- 根容器高度被覆盖；
- 外层 body/html 高度链不稳定；
- 响应式断点覆盖了桌面规则。

这次真正问题就在根容器，而不是 `.rec-list`。

### 8.2 `flex: 1 1 0` 不能无脑放在页面根节点

`flex: 1 1 0` 适合用于明确高度容器内部的“平分剩余空间”场景。  
但如果页面根节点本身还承担视口高度定义，就应该谨慎。

页面根节点更适合：

```css
flex: none;
height: calc(100dvh - navHeight);
```

内部区域再使用：

```css
flex: 1 1 0;
min-height: 0;
overflow: hidden;
```

### 8.3 验证不能只看源码，要抓线上产物

这次排查中比较有效的验证包括：

- 抓线上 HTML；
- 抓 CSS chunk；
- 抓 JS chunk；
- 校验 CSS/JS hash 是否一致；
- 确认新功能字符串是否存在；
- 确认新 CSS 规则是否进入构建产物。

这能快速区分：

- 是源码没改对；
- 是构建没跑；
- 是容器没重启；
- 是浏览器缓存；
- 还是 CSS 逻辑本身仍然错。

### 8.4 修复布局问题要先建立“高度所有权”

这类三栏管理页应该先明确：

1. 谁负责定义页面总高度；
2. 谁负责隐藏页面外溢；
3. 谁负责分配剩余空间；
4. 谁是真正滚动容器。

本页最终分工是：

- `main.student-manage`：定义页面总高度；
- `.cols`：分配三栏主区域；
- `.history-zone`：定义历史作业面板内部高度边界；
- `.rec-list`：真正滚动。

---

## 9. 后续检查建议

如果之后类似问题再次出现，优先检查：

1. 根节点是否有确定高度；
2. 根节点是否被 `flex-basis`、媒体查询或全局样式覆盖；
3. 滚动容器所有父级是否都有 `min-height: 0`；
4. 是否存在 `height: auto` 或内容撑开父级；
5. 当前浏览器宽度是否命中了响应式降级断点；
6. 线上 CSS chunk 是否真的包含本地最新规则。

---

## 10. 本次相关文件

- 页面组件：`frontend/app/admin/users/page.js`
- 页面样式：`frontend/app/admin/users/page.module.css`
- 全局设计系统：`frontend/app/design-system.css`
- 复盘文件：`debug-study/student-manage-history-scroll-bug.md`
