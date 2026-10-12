# 验证 `rollback` 版本回滚命令

本指南验证 **`rollback`** 命令——单次消费的版本恢复，回退最近一次 branch update 或 switch-version：

- 每次成功的 `update` 或 `switch-version` 只要变更了版本身份（commit、branch、ref 或 locked 标记），就会在 `<NEXUS_HOME>/rollback/<name>.json` 保存一个**恢复点**，用唯一 Git ref（`refs/nexus/rollback/<token>`）锚定旧 commit。
- `rollback <name>` 读取恢复点，校验当前 HEAD、manifest 和链接仍匹配记录的 "to" 状态，然后 checkout 旧 commit、恢复链接和 manifest，并**消费**该恢复点（删除 JSON）。没有 redo——用 `update` / `switch-version` 再次前进。
- 脏工作区触发警告后丢弃本地改动。
- 当前状态若已漂移（手动 git 操作、其他进程），rollback **拒绝**执行而非静默覆盖。

> **Shell 警告——Windows 用户：在 Git Bash（MINGW64）中跑下面的流程，**
> **不要用 PowerShell。** 以下所有命令块都是 POSIX / Bash 语法。命令使用
> `git -C <dir>`，不会 `cd` 进你的项目仓库，工作树不会被污染。

以下操作都是安全的：使用隔离的临时 `DSH_HOME`，本地 `file://` 远端代替
GitHub（无网络），不碰你真实的 `~/.dsh`。最后统一删除临时目录。

## 前置条件

- Node.js ≥ 20，且 `git` 在 `PATH` 中
- 已 checkout 仓库并执行过 `npm install`
- 如果改过 `src/`，先 `npm run build`——下面跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
```

| 测试文件 | 验证内容 |
|---|---|
| `test/rollback.test.ts` | 恢复点保存/消费/校验；anchor ref 创建；漂移检测；脏工作区丢弃；链接冲突拒绝；失败恢复（晚期失败还原 checkout + frontmatter + 链接）；JSON 输出 |
| `test/version-recovery.test.ts` | update / switch-version 晚期失败恢复精确 branch、commit、frontmatter、链接和 manifest；保留恢复诊断 |
| `test/update.test.ts` | update 在版本变更时创建恢复点；脏工作区不阻塞 |
| `test/switch-version.test.ts` | switch-version 创建恢复点；成功时清除显式锁 |

---

## 第二部分 — 端到端验证

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。

### Linux / macOS

```bash
# ---- 造上游仓库 ----
UP=/tmp/nexus-rb-up
rm -rf "$UP" /tmp/nexus-rb
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

# ---- 隔离的 DSH_HOME ----
export DSH_HOME=/tmp/nexus-rb
PROJECT=~/dsh-skills-nexus                              # ← 改成你的路径
cd "$PROJECT"

# ---- A) 按分支添加 skill ----
node lib/cli/index.js add "file://$UP#main"
node lib/cli/index.js list                              # COMMIT = v1 SHA
V1=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)
echo "v1 = $V1"

# ---- B) 上游推 v2，update ----
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update                            # ✓ xxxxxxx → yyyyyyy
V2=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)
echo "v2 = $V2"

# ---- C) 验证恢复点存在 ----
cat "$DSH_HOME/skills-nexus/rollback/up.json"
# 期望：JSON 含 "from"（v2 状态）和 "to"（v1 状态）、anchorRef

# ---- D) 回滚到 v1 ----
node lib/cli/index.js rollback up
# 期望：✓ <v2短SHA> → <v1短SHA>
#        恢复点已消费；如需再次前进请使用 update/switch-version
node lib/cli/index.js list                              # COMMIT 回到 v1

# ---- E) 恢复点已消费 ----
ls "$DSH_HOME/skills-nexus/rollback/up.json" 2>/dev/null; echo "exit=$?"
# 期望：exit=2（文件不存在——已消费）

# ---- F) 第二次 rollback 被拒绝 ----
node lib/cli/index.js rollback up; echo "exit=$?"
# 期望：error: No rollback point for "up", exit=1

# ---- G) 用 update 再次前进 ----
node lib/cli/index.js update                            # ✓ v1 → v2 再次
# 新恢复点被创建

# ---- H) --json 输出 ----
node lib/cli/index.js rollback up --json
# 期望：JSON 含 "status":"rolled-back"、fromCommit、toCommit

# ---- 清理 ----
rm -rf "$UP" /tmp/nexus-rb
unset DSH_HOME
```

### Windows（Git Bash / MINGW64）

```bash
# ---- 造上游仓库 ----
UP="$(cygpath -m "$TEMP/nexus-rb-up")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb")"
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

# ---- 隔离的 DSH_HOME ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-rb")"
PROJECT=~/Downloads/dsh-skills-nexus                    # ← 改成你的路径
cd "$PROJECT"

# ---- A) 按分支添加 ----
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list
V1=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)

# ---- B) 推 v2，update ----
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update
V2=$(git -C "$DSH_HOME/skills-nexus/repos/up" rev-parse HEAD)

# ---- C) 恢复点存在 ----
cat "$DSH_HOME/skills-nexus/rollback/up.json"

# ---- D) 回滚 ----
node lib/cli/index.js rollback up
node lib/cli/index.js list                              # COMMIT 回到 v1

# ---- E) 已消费 ----
ls "$DSH_HOME/skills-nexus/rollback/up.json" 2>/dev/null; echo "exit=$?"   # → exit=2

# ---- F) 第二次被拒绝 ----
node lib/cli/index.js rollback up; echo "exit=$?"               # → exit=1

# ---- G) 再次前进 ----
node lib/cli/index.js update

# ---- H) --json ----
node lib/cli/index.js rollback up --json

# ---- 清理 ----
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb")"
unset DSH_HOME
```

---

## 第三部分 — 漂移检测

当前状态若偏离了恢复点记录的 "to" 状态（如克隆内手动 git 操作），rollback 会拒绝。

### Linux / macOS

```bash
UP=/tmp/nexus-rb-drift
rm -rf "$UP" /tmp/nexus-rb-drift
mkdir -p "$UP" && cd "$UP" && git init -b main
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo\n---\n# v1\n' > SKILL.md
git add . && git commit -m v1

export DSH_HOME=/tmp/nexus-rb-drift
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

node lib/cli/index.js add "file://$UP#main"

# 推 v2 并 update（创建恢复点）
cd "$UP"
printf -- '---\nname: demo\ndescription: v2\n---\n# v2\n' > SKILL.md
git add . && git commit -m v2
cd "$PROJECT"
node lib/cli/index.js update

# 手动漂移：checkout 到其他 commit
cd "$DSH_HOME/skills-nexus/repos/up"
git fetch --depth 1 origin main
git checkout FETCH_HEAD                   # 漂移离开期望状态
cd "$PROJECT"

# rollback 应拒绝
node lib/cli/index.js rollback up; echo "exit=$?"
# 期望：error: Rollback refused: current HEAD, manifest or links have drifted
# exit=1

rm -rf "$UP" /tmp/nexus-rb-drift
unset DSH_HOME
```

### Windows（Git Bash）

命令与上面相同，只需替换路径写法：

```bash
UP="$(cygpath -m "$TEMP/nexus-rb-drift")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb-drift")"
# ... 与上面相同 ...
export DSH_HOME="$(cygpath -m "$TEMP/nexus-rb-drift")"
# ... 同样的命令 ...
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-rb-drift")"
unset DSH_HOME
```

---

## 第四部分 — 脏工作区警告

脏克隆触发警告但不阻塞 rollback。

```bash
# 在 D 步之后（清理前），或重新搭建：
# ... 设置 UP、DSH_HOME、add、推 v2、update ...

# 弄脏克隆
cd "$DSH_HOME/skills-nexus/repos/up"
printf 'local edit\n' >> SKILL.md
cd "$PROJECT"

node lib/cli/index.js rollback up
# 期望：⚠ discarding local changes in nexus-managed clone
#        ✓ <v2短SHA> → <v1短SHA>
#        恢复点已消费
```

---

## 每一步应该输出什么

| 步骤 | 期望输出 | 含义 |
|------|----------|------|
| D：`rollback up` | `✓ abc1234 → def5678` + 消费消息 | 恢复到 v1，恢复点已消费 |
| E：文件检查 | `exit=2`（不存在） | 回滚 JSON 已删 |
| F：第二次 rollback | `error: No rollback point for "up"`，exit=1 | 确认单次消费 |
| G：`update` 再次 | `✓ v1 → v2` | 新恢复点被创建 |
| H：`--json` | `{"version":1,"results":[{"status":"rolled-back",...}]}` | 机器可读 |
| 漂移：手动 checkout | `Rollback refused: current HEAD...drifted`，exit=1 | 漂移检测生效 |
| 脏：本地改动 | `⚠ discarding local changes…` + `✓ ...` | 脏警告 + 成功 |

---

## 实践中踩过的坑

1. **注册名是仓库 URL 的最后一段，不是 "demo"** —— `rollback demo`
   会报 `No skill named "demo"`。不确定时先 `list` 看实际名字（这里
   是 `up`）。
2. **rollback 刻意单次消费。** 消费后没有 redo。用 `update` 或
   `switch-version` 再次前进——每次都会为下一次 rollback 创建新恢复点。
3. **只有版本身份变更才创建恢复点。** 空操作 update（分支 pin 已在最
   新）不创建恢复点——没有东西可回滚。
4. **detached HEAD 和 locked 条目** —— 只要有恢复点（由之前的
   `switch-version` 创建），rollback 同样适用。
5. **漂移检测很严格。** 版本变更和 rollback 之间任何手动
   `git checkout`、`git fetch` + checkout 或克隆内外部 manifest 编辑都
   会导致拒绝。这是刻意设计——rollback 宁可拒绝也不静默覆盖。
6. **链接冲突检查** —— 如果旧恢复点的链接名已被其他条目的链接占
   用，rollback 会报 `link collision at "<name>"` 拒绝。防止一个
   rollback 覆盖其他条目的 symlink。
7. **跑的是编译产物** —— 流程使用 `lib/`；改过 `src/` 后先
   `npm run build` 再验证。

---

## 覆盖边界

本指南刻意不覆盖的内容：

- **真实 GitHub 网络** —— 本地 `file://` 远端与真实远端走同一套 git 语
  义，且不受网络波动影响。
- **DSH 运行时集成** —— rollback 是 nexus 内部操作；不与 DSH 插件或面
  板交互。
- **HTTP 路由** —— 没有 HTTP rollback 路由；该功能仅 CLI。共享核心
  （`rollbackEntry`）可供未来 HTTP 集成使用。
- **Node 20 / 22 / 24 矩阵** —— CI（`.github/workflows/ci.yml`）在
  push/PR 时跑完整质量门禁。
