# 验证插件装载契约（plugin add → dsh web 冷启动）

本指南验证 **插件装载契约**：

- **A. 安装注册** —— `dsh plugin --profile <name> add` 安装本包后，reconcile 依据
  `package.json` 的 `dsh.bundle.patch: cordis.patch.yml` 声明，把本包追加进 profile 的
  `dsh.profile.bundles` 层。
- **B. 冷启动加载** —— `dsh web` 启动时，`cordis.patch.yml` 的 `insert` 条目以**裸包名**
  交给 cordis 加载器，经 Node 模块解析命中 profile `node_modules` 中的包，由 `main` /
  `exports["."]` 加载 `lib/index.js`。

契约由两处共同构成，缺一不可：

1. `cordis.patch.yml` 的 entry 必须是**裸包名**（`'dsh-skills-nexus'`）——相对路径会被锚定到
   profile 根目录解析，指向结构性不存在的 `<profile>/lib/index.js`；
2. `package.json` 必须有 `main` 与 `exports["."]` 指向 `lib/index.js`。

任一处破坏，`dsh web` 冷启动即报 `ERR_MODULE_NOT_FOUND`、整个插件树加载失败。入口 `apply()`
是 no-op（skill 发现靠 symlink + 官方 filesystem provider），插件未被加载不产生任何功能症状，
只有整树崩溃这一种表现——所以触碰契约的改动必须重跑本指南。

## 与真实 `~/.dsh` 的关系（先读）

- **本流程会写入你真实的 `~/.dsh/profiles/web/`**（安装、启动、卸载）。这是无法
  用临时 `DSH_HOME` 替代的：被验证的恰恰是真实 profile 的装载链路。
- **不访问 GitHub、不创建链接**：修复未推送前用本地 `file:` 源代替
  `github:` 规格；装载验证不调用 `dsh-skills-nexus add`，因此不涉及任何链接创建。
- 结尾的清理步骤把 profile 恢复原状（仅剩基础 bundle）。

## 前置条件

- Node.js ≥ 20（`package.json` 的 `engines`），`npx` 可用，能访问 npm registry
- 已 checkout 本仓库；若改过 `src/`，先 `npm run build`（装载的是 `lib/` 产物）
- 本机存在 `web` profile（跑过一次 `dsh web` 即会自动初始化）

---

## 第一部分 — 质量门禁（静态检查契约）

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
```

契约三项静态检查（任一不满足即为回归）：

```bash
grep -n "name:" cordis.patch.yml      # 期望：name: 'dsh-skills-nexus'——裸包名，无 './' 前缀
grep -n '"main":' package.json        # 期望："main": "lib/index.js"
grep -n '"\.":' package.json          # 期望：exports 含 ".": "./lib/index.js"
```

---

## 第二部分 — 端到端验证（本地源代替 GitHub）

修复未推送前，远端提交可能仍是坏契约，`github:` 安装只会复现崩溃，所以用本地
工作区作包源。**`file:` 之后的一切实例化步骤与真实 `github:` 安装完全一致**：
pnpm 装入 profile 的 `node_modules` → reconcile 注册 bundle → 冷启动解析。

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。

### Windows（Git Bash / MINGW64）

```bash
PROJECT="$(cygpath -m ~/Downloads/dsh-skills-nexus)"   # ← 改成你的路径（正斜杠）
cd "$PROJECT"

echo "--- [a] 安装本地包 ---"
npx @deepseek-ai/dsh plugin --profile web add "file:$PROJECT"; echo "exit=$?"

echo "--- [b] 确认注册进 bundles 层 ---"
cat ~/.dsh/profiles/web/package.json
# 期望：dsh.profile.bundles 含 "dsh-skills-nexus"，dependencies 含 file: 条目

echo "--- [c] 冷启动（原事故崩溃点）---"
npx @deepseek-ai/dsh web --no-open
# 期望：打印 "dsh web: http://127.0.0.1:3080"，无 loader 报错、进程不退出；保持运行
```

另开一个 Git Bash 窗口：

```bash
echo "--- [d] 服务在监听 ---"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080   # 期望：200
```

回到 [c] 窗口 `Ctrl+C` 停止服务，然后清理：

```bash
echo "--- [e] 清理：移除插件 ---"
npx @deepseek-ai/dsh plugin --profile web remove dsh-skills-nexus; echo "exit=$?"
cat ~/.dsh/profiles/web/package.json
# 期望：bundles 只剩基础项，dependencies 中 dsh-skills-nexus 已消失
```

### macOS / Linux

```bash
PROJECT="$(pwd)"          # ← 在仓库根目录执行；或写绝对路径
cd "$PROJECT"

echo "--- [a] 安装本地包 ---"
npx @deepseek-ai/dsh plugin --profile web add "file:$PROJECT"; echo "exit=$?"

echo "--- [b] 确认注册进 bundles 层 ---"
cat ~/.dsh/profiles/web/package.json

echo "--- [c] 冷启动（原事故崩溃点）---"
npx @deepseek-ai/dsh web --no-open
# 期望同 Windows；保持运行，另开终端跑 [d]：
#   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080   # 期望：200
# [c] 窗口 Ctrl+C 后：

echo "--- [e] 清理：移除插件 ---"
npx @deepseek-ai/dsh plugin --profile web remove dsh-skills-nexus; echo "exit=$?"
cat ~/.dsh/profiles/web/package.json
```

---

## 判定标准

| 步骤 | 通过 | 失败信号 |
|---|---|---|
| [a] | `exit=0`，pnpm 安装成功 | pnpm 报错 / reconcile 警告 `declares no dsh.bundle` |
| [b] | bundles 含 `dsh-skills-nexus` | 缺失（`dsh.bundle.patch` 声明被破坏） |
| [c] | 打印监听地址，持续无报错 | `failed to import loader entry dsh-skills-nexus` / `ERR_MODULE_NOT_FOUND` / 进程退出 |
| [d] | HTTP 200 | 连接拒绝 |
| [e] | `exit=0`，profile 恢复原状 | 残留依赖或 bundle |

启动崩溃发生在树组装早期，[c] 保持约 10 秒无异常即可判定通过。

---

## 推送后的真实 `github:` 复验

修复提交并推送后，把 [a] 换成真实规格，重跑 [b]–[e]，补齐 tarball 拉取这一环：

```bash
npx @deepseek-ai/dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

此后若继续验证 skill 功能（`dsh-skills-nexus add` 等），请移步另外两份 `verify-*`
文档，与本契约无关。

---

## 设计备注

- **为什么不删掉 bundle 声明、只做纯 CLI 包？** 保留 `dsh.bundle` 使包维持
  profile 层身份（reconcile 不产生 `declares no dsh.bundle` 警告），且为将来
  恢复运行时集成留门；`apply()` no-op 使加载零副作用。
- **维护规则**：任何触碰 `cordis.patch.yml`、`main`、`exports`、`dsh.bundle` 的
  改动，都必须重跑本指南。
