# 验证克隆重试功能（P0）

本指南验证 **`cloneRepo` 的指数退避重试** 改动（弱网健壮性）：

- `src/git.ts` 新增通用 `retry(fn, { retries, minDelay })`：失败后按 `minDelay * 2^attempt` 指数退避重试，**已导出**供测试与观测。
- `cloneRepo` 仅对**分支 / 标签**克隆包一层 `retry({ retries: 1, minDelay: 500 })`（共 2 次尝试、中间 1 次 500ms 等待）——网络抖动时多给一次机会。
- **commit-SHA pin 不重试**：`git clone --branch <40位SHA>` 是确定性失败（恒 `exit=128`），重试纯属浪费；仍走原有 `clone + fetch + checkout` fallback（行为零变化）。
- **对正常克隆零影响**：首次成功即 `return`，不进 catch、不 `setTimeout`、不进第二次循环；成功路径的 git 命令 / 参数 / 结果与改造前逐字节一致。**不含超时**，故不会误伤大仓库 / 慢网络。

以下操作都是安全的：不碰你真实的 `~/.dsh`、不访问任何真实 GitHub 仓库、当前项目仓库只被读取（或经 `npm run build` 重新编译）。所有临时状态都在专用临时目录里，最后统一删除。

> **⚠️ Shell 警告（务必先读）**
>
> - **Windows 用户：本指南所有命令块都是 Git Bash（MINGW64）/ bash 语法，请在 Git Bash 里运行。**
> - **不要把这些块粘进 PowerShell 或 cmd**：`VAR=...`、`cygpath`、`printf`、`&&`、`rm -rf`、`$(...)` 在 PowerShell 里语义不同或直接报错。典型事故是——把 PowerShell 块（`Push-Location` / `New-Item` / `Remove-Item`）粘进 Git Bash，cmdlet 全部 `command not found`，而 `Push-Location` **静默失败导致目录没切换**，后续 `git init` / `config` / `commit` / `tag` 就落进了**当前项目仓库**，凭空造出一个提交、一个标签，还改掉 git 身份。
> - 本指南已从结构上杜绝该事故：第三部分造上游仓库的每条 git 命令都用 `git -C "$UP"` **显式指向临时目录**、**全程不含 `cd`**，即使你在项目目录里逐行粘贴，也绝不会 re-init、改身份、误提交或打标签到当前项目。

## 前置条件

- Node.js ≥ 18，且 `git` 在 `PATH` 中
- 已 checkout 仓库并执行过 `npm install`（测试依赖 `node_modules` 里的 `tsx`）
- 如果改过 `src/`，先 `npm run build`——下面的流程跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
npm run test:build  # 可选：把 src+test 编译到 test-dist/，无 loader 环境可跑
```

测试套件绝不碰你的真实环境：每个测试文件都使用临时 `DSH_HOME` + `mkdtemp` 目录，由 `after()` 钩子自动清理。

本次改动新增 4 条测试（较此前 +4），都在 `test/git.test.ts`：

| 测试 | 验证内容 |
|---|---|
| `retry returns result on first success` | 首次即成功 → 只调用 1 次、不进退避 |
| `retry exhausts attempts then throws` | 一直失败 → 调用 `retries+1` 次后抛出最后一个错误 |
| `retry succeeds on second attempt` | 第一次失败、第二次成功 → 调用 2 次后返回 |
| `cloneRepo at a raw commit SHA falls back to clone+fetch+checkout` | commit-SHA pin 走 fallback、克隆后 detached HEAD（改造前先跑通锁定现状，确认「不重试」也不破坏该路径）|

---

## 第二部分 — 直接观测指数退避（跨平台，零副作用）

纯内存调用导出的 `retry`，打印每次尝试的相对时间戳。**不碰文件系统、不碰 git、不碰网络、不改仓库状态**——只 `import` 只读的 `lib/git.js`。在**项目根目录**（含 `lib/` 的那层）执行：

```bash
node --input-type=module -e "import {retry} from './lib/git.js'; let n=0; const t0=Date.now(); const r=await retry(async()=>{n++; console.log('attempt '+n+' @+'+(Date.now()-t0)+'ms'); if(n<3) throw new Error('flaky'); return 'recovered';},{retries:3,minDelay:200}); console.log('result='+r+' total_calls='+n);"
```

期望输出（退避间隔约 `minDelay * 2^attempt` = 200ms、400ms，累计 ~200ms、~600ms，实际有几十毫秒抖动）：

```
attempt 1 @+0ms
attempt 2 @+2xx ms        # 第一次失败后等 ~200ms 再试
attempt 3 @+6xx ms        # 第二次失败后等 ~400ms 再试（累计 ~600ms）
result=recovered total_calls=3
```

含义：前两次抛错触发退避重试，第三次成功即返回，总调用 3 次。这一条同时证明了**指数退避的时序**与**成功即停**（不会多调用）。这也是本指南观测「重试真的会触发」的**确定性手段**——真实网络抖动无法按需复现，故用这条纯函数调用来锁定退避行为。

---

## 第三部分 — 端到端回归：三种 pin 都能正常克隆

目的：证明 `cloneRepo` 加了 `retry` 包裹后，**分支 / 标签 / commit-SHA** 三种 pin 的正常克隆路径零回归。

> 注意：本地 `file://` 克隆不会真的「瞬态失败」，所以这里**不触发重试**；重试的触发已在第二部分用 `node -e` 确定性观测。本部分验证的是「改造没弄坏正常路径」。

安全设计（重申）：造上游仓库的每条 git 命令都用 `git -C "$UP"`、**全程无 `cd`**；CLI 只在项目目录里**读取** `lib/`，写入全部落在临时 `DSH_HOME`。

### Windows（Git Bash / MINGW64）

```bash
# ---- 造上游仓库（隔离在临时目录；git -C 显式指向，无 cd，逐行粘贴也不碰项目）----
UP="$(cygpath -m "$TEMP/retry-up")"
DEMO="$(cygpath -m "$TEMP/retry-demo")"
rm -rf "$UP" "$DEMO"                                  # 清掉上次残留
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥2.28；显式 -C，无需 cd
git -C "$UP" config user.email t@t                    # 只写入临时仓库的 local config
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"   # 绝对路径写入；frontmatter 完整→克隆不被归一化弄脏
git -C "$UP" add -A && git -C "$UP" commit -m init && git -C "$UP" tag v1.0.0

# ---- 隔离的 DSH_HOME + 在项目目录里跑 CLI ----
export DSH_HOME="$DEMO"
PROJECT=~/Downloads/dsh-skills-nexus                  # ← 改成你的路径
cd "$PROJECT"

# A) 分支 pin：cloneRepo 走 retry 包裹的 --branch 路径
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list                            # COMMIT = main 当前 SHA

# B) 标签 pin：--branch <tag> 同样走 retry 路径，克隆后 detached HEAD
node lib/cli/index.js remove retry-up                 # 注册名 = 仓库目录名（URL 最后一段）
node lib/cli/index.js add "file:///$UP#v1.0.0"
node lib/cli/index.js list

# C) commit-SHA pin：不重试；--branch <sha> 确定性失败后走 clone+fetch+checkout fallback
node lib/cli/index.js remove retry-up
SHA=$(git -C "$UP" rev-parse HEAD)
node lib/cli/index.js add "file:///$UP#$SHA"
node lib/cli/index.js list                            # COMMIT = $SHA，detached HEAD

# D) 为什么 commit-SHA 不重试——直接观测那个确定性失败（克隆进临时目录，随即删除）
PROBE="$(cygpath -m "$TEMP/retry-sha-probe")"
rm -rf "$PROBE"
git clone --branch "$SHA" "file:///$UP" "$PROBE"; echo "exit=$?"   # → Remote branch <sha> not found … exit=128
rm -rf "$PROBE"

# ---- 查看锁 ----
cat "$DSH_HOME/skills-nexus/manifest.json"            # 每条都有 "commit"

# ---- 清理（删临时目录 + 取消 DSH_HOME；不碰项目）----
rm -rf "$UP" "$DEMO"
unset DSH_HOME
```

### Linux / macOS

```bash
# ---- 造上游仓库（git -C 显式指向，无 cd）----
UP=/tmp/retry-up
DEMO=/tmp/retry-demo
rm -rf "$UP" "$DEMO"
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥2.28；旧版用：git init && git -C "$UP" symbolic-ref HEAD refs/heads/main
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add -A && git -C "$UP" commit -m init && git -C "$UP" tag v1.0.0

# ---- 隔离的 DSH_HOME + CLI ----
export DSH_HOME="$DEMO"
PROJECT=~/dsh-skills-nexus                            # ← 改成你的路径
cd "$PROJECT"

node lib/cli/index.js add "file://$UP#main"           # A) 分支 pin
node lib/cli/index.js list

node lib/cli/index.js remove retry-up                 # B) 标签 pin
node lib/cli/index.js add "file://$UP#v1.0.0"
node lib/cli/index.js list

node lib/cli/index.js remove retry-up                 # C) commit-SHA pin
SHA=$(git -C "$UP" rev-parse HEAD)
node lib/cli/index.js add "file://$UP#$SHA"
node lib/cli/index.js list

PROBE=/tmp/retry-sha-probe                            # D) 确定性失败观测
rm -rf "$PROBE"
git clone --branch "$SHA" "file://$UP" "$PROBE"; echo "exit=$?"
rm -rf "$PROBE"

cat "$DSH_HOME/skills-nexus/manifest.json"

rm -rf "$UP" "$DEMO"
unset DSH_HOME
```

---

## 每一步应该输出什么

| 步骤 | 期望输出 | 含义 |
|---|---|---|
| 第二部分：`node -e` 退避 | `attempt 1 @+0ms` / `attempt 2 @+2xx ms` / `attempt 3 @+6xx ms` / `total_calls=3` | 指数退避时序正确、成功即停 |
| 第三部分 A：分支 pin `add` | `Added skill "retry-up" …`，`list` 的 COMMIT = main SHA | retry 包裹的 `--branch` 路径正常 |
| 第三部分 B：标签 pin `add` | `list` 的 COMMIT = v1.0.0 指向的 SHA（单提交仓库，与 A 相同）| `--branch <tag>` 路径正常，克隆后 detached HEAD |
| 第三部分 C：commit-SHA pin `add` | `list` 的 COMMIT = `$SHA` | 不重试，走 clone+fetch+checkout fallback 成功 |
| 第三部分 D：`git clone --branch <sha>` | `fatal: Remote branch <sha> not found …` + `exit=128` | commit-SHA 是确定性失败——这正是它不该被重试的原因 |
| `manifest.json` | 每条含 `"commit": "<40位SHA>"` | 版本锁本身（与 clone-retry 正交，顺带确认没被破坏）|

---

## 实践中踩过的坑

1. **别混用 shell。** 本指南的块是 bash 语法，Windows 请在 **Git Bash** 里跑。把 PowerShell 块粘进 bash（或反之）会让 `Push-Location` / `cd` 之类的目录切换**静默失败**，后续 `git init` / `config` / `commit` / `tag` 就落进当前目录——如果当前目录是你的项目仓库，就会凭空造出提交、标签并改掉 git 身份。本文档用 `git -C "$UP"` + 无 `cd` 从结构上规避了这一点。
2. **万一真的误伤了项目仓库怎么救？** 若尚未 push：`git tag -d <误打的 tag>`；`git reset --hard <正确的 commit>`（例如与 `origin/master` 一致的 SHA）；`git config --local user.name` / `user.email` 改回你自己的身份。`git reflog` 能帮你找回被 reset 掉的提交。**切勿**在真实项目里跑第三部分清理段之外的删除命令。
3. **注册名是仓库 URL 的最后一段**，这里是 `retry-up`（不是 frontmatter 里的 `demo`）。不确定时先 `node lib/cli/index.js list`。
4. **一个仓库 = 一个条目。** 换 ref 要先 `remove retry-up` 再 `add`（本指南 A→B→C 之间就是这么做的）。
5. **commit-SHA 的 fallback 依赖 `git fetch origin <sha>`。** 本指南的上游仓库只有**单个提交**，`$SHA` 即 HEAD，浅克隆后该对象已在本地，fallback 必然成功。若你的上游有多个提交且 `$SHA` 指向较旧的提交，服务端需开启 `uploadpack.allowReachableSHA1InWant` 才能按 SHA fetch——这不影响本指南（单提交）。
6. **平台路径格式。** Windows Git Bash：`cygpath -m` 转换，URL 用 `file:///C:/...`；Linux / macOS：绝对路径 `/tmp/...`，URL 用 `file:///tmp/...`。
7. **`git -C` 需要 git ≥ 1.8.5**（2013 年，几乎必然满足）；`git init -b main` 需要 git ≥ 2.28（2019），旧版用 `git init && git -C "$UP" symbolic-ref HEAD refs/heads/main`。
8. **跑的是编译产物** —— 第二、三部分都用 `lib/`；改过 `src/` 后先 `npm run build`。

---

## 覆盖边界

本指南刻意不覆盖的内容：

- **真实 GitHub 网络抖动** —— 本地 `file://` 远端与真实远端走同一套 git 语义，但不会瞬态失败。重试的**触发**用第二部分的 `node -e` 纯函数调用来确定性观测；`cloneRepo` 是否把 `retry` 包在了分支 / 标签克隆上，是 `src/git.ts` 里可直接审阅的一行（`retry(branchClone, { retries: 1, minDelay: 500 })`）。
- **端到端注入真实 git 失败以观测第二次尝试** —— 本地不做。Windows 上 Node 的 `execFile('git', …)` 出于 CVE-2024-27980 缓解会拒绝 / 绕过 `.cmd` / `.bat` wrapper，无法用「PATH 里放假 git」来拦截计数；Linux / macOS 虽可用 shell wrapper 实现，但相对第二部分收益有限、且会引入额外临时可执行文件，故不纳入。
- **超时** —— 本轮**不引入**超时：超时会在「正常但慢」的克隆尚未失败时强杀，可能误伤大仓库；且 `getDefaultBranch`（`ls-remote`）等其他网络调用未被覆盖。按 YAGNI 移出本轮。
- **DSH 运行时集成 / Node 20-22-24 矩阵** —— 见 `verify-version-lock` 与 CI（`.github/workflows/ci.yml`）。
