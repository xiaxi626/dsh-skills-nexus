# 验证版本锁定功能（P0）

本指南验证 **版本锁定（lockfile-lite）** 改动：

- `add` 会把实际安装到的 commit 记入 `manifest.json`（新增 `commit` 字段）——`list` 以短 SHA 显示。
- `update` 按 pin 类型分派：**分支 pin 快进拉取**、**tag/commit pin 是固定点**（只校验、绝不拉取），已固定但发生漂移的 checkout 会**自动恢复**。
- 重复 `add` 已注册的仓库会被**拒绝**，且不影响已有克隆。

以下操作都是安全的：不碰你真实的 `~/.dsh`、不访问任何 GitHub 仓库、当前仓库只被读取（或经 `npm run build` 重新编译）。所有临时状态都在专用临时目录里，最后统一删除。

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

| 测试文件 | 验证内容 |
|---|---|
| `test/add.test.ts` | `add` 记录解析到的 commit；重复添加被拒绝且克隆完好 |
| `test/update.test.ts` | 分支 pin 快进并重新盖章 commit；tag pin 是固定点；漂移的 checkout 被恢复；脏工作区（归一化产物）不阻塞快进与漂移恢复 |
| `test/git.test.ts` | `getHeadCommit` / `isDetachedHead` / `resolveRefCommit` / `checkoutRef`；按 tag 克隆 → detached HEAD，按分支克隆 → symbolic HEAD |
| `test/manifest.test.ts` | `markUpdated` 盖章 `updatedAt` + `commit` |

---

## 第二部分 — 端到端验证

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。

### Windows（Git Bash / MINGW64）

```bash
# ---- 造上游仓库（模拟 GitHub 上的 skill 仓库）----
UP="$(cygpath -m "$TEMP/up")"
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-demo")"      # 清掉上次残留
mkdir -p "$UP" && cd "$UP" && git init -b main        # git ≥2.28
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > SKILL.md   # frontmatter 完整且置于文件开头：克隆不会被归一化弄脏（否则 C 步的手动 checkout 会被脏工作区阻塞，见坑 #11）
git add . && git commit -m init && git tag v1.0.0

# ---- 隔离的 DSH_HOME + CLI ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-demo")"
PROJECT=~/Downloads/dsh-skills-nexus                  # ← 改成你的路径
cd "$PROJECT"

# ---- A) tag pin = 固定点 ----
node lib/cli/index.js add "file:///$UP#v1.0.0"
node lib/cli/index.js list                            # COMMIT 列显示短 SHA

cd "$UP" && printf '# demo v2\n---\nname: demo\ndescription: v2\n' > SKILL.md
git add . && git commit -m second                     # 上游往前走了
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ pinned at xxxxxxx — nothing to update
node lib/cli/index.js list        # COMMIT 不变

# ---- B) 分支 pin = 快进 ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file:///$UP#main"
node lib/cli/index.js list        # COMMIT = main 当前最新

cd "$UP" && printf '# demo v3\n---\nname: demo\ndescription: v3\n' > SKILL.md
git add . && git commit -m third
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT 和 UPDATED 都刷新了

# ---- B2) 脏克隆不阻塞 update（归一化会原地改 SKILL.md）----
cd "$DSH_HOME/skills-nexus/repos/up"
printf 'local edit\n' >> SKILL.md            # 模拟被本地改动的已跟踪文件
cd "$PROJECT"
cd "$UP" && printf '# demo v4\n---\nname: demo\ndescription: v4\n' > SKILL.md
git add . && git commit -m fourth            # 上游动了同一个文件
cd "$PROJECT"
node lib/cli/index.js update      # → ⚠ discarding local changes… 然后 ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT 前进到 v4

# ---- C) 漂移自愈 ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file:///$UP#v1.0.0"
cd "$DSH_HOME/skills-nexus/repos/up"
git fetch --depth 1 origin main   # 把较新的提交拉进浅克隆
git checkout FETCH_HEAD           # 故意漂移离开 pin
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ restored to pinned xxxxxxx
node lib/cli/index.js list        # COMMIT 回到 pin 的 SHA

# ---- D) 重复 add 保护 ----
node lib/cli/index.js add "file:///$UP#v1.0.0"; echo "exit=$?"   # → 被拒绝，期望 exit=1
node lib/cli/index.js list        # 克隆仍在且完好

# ---- 查看锁 ----
cat "$DSH_HOME/skills-nexus/manifest.json"            # 每条都有 "commit"

# ---- 清理 ----
rm -rf "$UP" "$(cygpath -m "$TEMP/nexus-demo")"
unset DSH_HOME
```

### Linux / macOS

```bash
# ---- 造上游仓库（模拟 GitHub 上的 skill 仓库）----
UP=/tmp/nexus-up
rm -rf "$UP" /tmp/nexus-demo                            # 清掉上次残留
mkdir -p "$UP" && cd "$UP" && git init -b main          # git ≥2.28；旧版用：`git init && git symbolic-ref HEAD refs/heads/main`
git config user.email t@t && git config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > SKILL.md   # frontmatter 完整且置于文件开头：克隆不会被归一化弄脏（否则 C 步的手动 checkout 会被脏工作区阻塞，见坑 #11）
git add . && git commit -m init && git tag v1.0.0

# ---- 隔离的 DSH_HOME + CLI ----
export DSH_HOME=/tmp/nexus-demo
PROJECT=~/dsh-skills-nexus                              # ← 改成你的路径
cd "$PROJECT"

# ---- A) tag pin = 固定点 ----
node lib/cli/index.js add "file://$UP#v1.0.0"
node lib/cli/index.js list                              # COMMIT 列显示短 SHA

cd "$UP" && printf '# demo v2\n---\nname: demo\ndescription: v2\n' > SKILL.md
git add . && git commit -m second                       # 上游往前走了
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ pinned at xxxxxxx — nothing to update
node lib/cli/index.js list        # COMMIT 不变

# ---- B) 分支 pin = 快进 ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file://$UP#main"
node lib/cli/index.js list        # COMMIT = main 当前最新

cd "$UP" && printf '# demo v3\n---\nname: demo\ndescription: v3\n' > SKILL.md
git add . && git commit -m third
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT 和 UPDATED 都刷新了

# ---- B2) 脏克隆不阻塞 update（归一化会原地改 SKILL.md）----
cd "$DSH_HOME/skills-nexus/repos/up"
printf 'local edit\n' >> SKILL.md            # 模拟被本地改动的已跟踪文件
cd "$PROJECT"
cd "$UP" && printf '# demo v4\n---\nname: demo\ndescription: v4\n' > SKILL.md
git add . && git commit -m fourth            # 上游动了同一个文件
cd "$PROJECT"
node lib/cli/index.js update      # → ⚠ discarding local changes… 然后 ✓ xxxxxxx → yyyyyyy
node lib/cli/index.js list        # COMMIT 前进到 v4

# ---- C) 漂移自愈 ----
node lib/cli/index.js remove up
node lib/cli/index.js add "file://$UP#v1.0.0"
cd "$DSH_HOME/skills-nexus/repos/up"
git fetch --depth 1 origin main   # 把较新的提交拉进浅克隆
git checkout FETCH_HEAD           # 故意漂移离开 pin
cd "$PROJECT"
node lib/cli/index.js update      # → ✓ restored to pinned xxxxxxx
node lib/cli/index.js list        # COMMIT 回到 pin 的 SHA

# ---- D) 重复 add 保护 ----
node lib/cli/index.js add "file://$UP#v1.0.0"; echo "exit=$?"    # → 被拒绝，期望 exit=1
node lib/cli/index.js list        # 克隆仍在且完好

# ---- 查看锁 ----
cat "$DSH_HOME/skills-nexus/manifest.json"             # 每条都有 "commit"

# ---- 清理 ----
rm -rf "$UP" /tmp/nexus-demo
unset DSH_HOME
```

---

## 第三部分 — 集合仓库（`--subdir`）

集合仓库的 skill 藏在子目录里（`skills/<name>/SKILL.md`，如 `trae-community/trae-skills`）。整个仓库安装会被拒绝（根目录没有可安装的 skill）——用 `--subdir` 按需安装其中一个 skill 目录。

### Linux / macOS

```bash
# 造一个"集合仓库"
COLL=/tmp/nexus-col
rm -rf "$COLL" /tmp/nexus-col-demo
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"          # 根目录文档绝不能变成 skill
printf '# board\n' > "$COLL/community-leaderboard.md"
cd "$COLL" && git init -b main
git config user.email t@t && git config user.name t
git add . && git commit -m init

export DSH_HOME=/tmp/nexus-col-demo
cd "$PROJECT"

node lib/cli/index.js add "file://$COLL"                       # → 被拒绝，提示改用 --subdir
node lib/cli/index.js add "file://$COLL" --subdir skills/alpha # → 成功
node lib/cli/index.js list                                      # SUBDIR 列 = skills/alpha
dsh-skills-nexus list
# 检查 symlink 是否创建
ls -la "$DSH_HOME/skills/"
# → 只有 alpha-skill；README.zh-CN.md / community-leaderboard.md 都不是 skill

rm -rf "$COLL" /tmp/nexus-col-demo
unset DSH_HOME
```

### Windows（Git Bash）

命令与上面相同，只需替换路径写法：

```bash
COLL="$(cygpath -m "$TEMP/collection")"
rm -rf "$COLL" "$(cygpath -m "$TEMP/nexus-col-demo")"
# ... 按上面原样创建仓库 ...
export DSH_HOME="$(cygpath -m "$TEMP/nexus-col-demo")"
# ... 同样的 add/list 命令，清理用：
rm -rf "$COLL" "$(cygpath -m "$TEMP/nexus-col-demo")"
unset DSH_HOME
```

---

## 每一步应该输出什么

| 步骤 | 期望输出 | 含义 |
|---|---|---|
| A：tag pin 执行 `update` | `✓ pinned at xxxxxxx — nothing to update` | 固定点：上游动了，克隆没动 |
| B：分支 pin 执行 `update` | `✓ xxxxxxx → yyyyyyy`（或 `up to date`） | 已快进，锁已重新盖章 |
| B2：脏克隆执行 `update` | `⚠ discarding local changes…` + `✓ xxxxxxx → yyyyyyy` | 本地改动被丢弃（有警告），快进不受影响 |
| C：漂移后执行 `update` | `✓ restored to pinned xxxxxxx` | 检测到漂移并自动 checkout 回 pin |
| D：重复 `add` | 拒绝提示，exit code 1 | 保护生效；已有克隆不受影响 |
| `manifest.json` | 每条含 `"commit": "<40位SHA>"` | 锁本身 |

---

## 实践中踩过的坑

1. **注册名是仓库 URL 的最后一段，不是 "demo"** —— `remove demo` 会报
   `No skill named "demo"`。这里的名字是 `up`；不确定时先 `node lib/cli/index.js list`。
2. **重复 add 已注册的仓库被拒——这是保护，不是 bug。** 想换 ref 先
   `remove`，只想追新就用 `update`。
3. **浅克隆里只有 pin 的那个提交。** `git checkout 118eecf` 会报
   `pathspec '118eecf' did not match`——因为该对象不在 `--depth 1` 克隆里。
   模拟漂移要先 `git fetch --depth 1 origin main`，再 `git checkout FETCH_HEAD`。
4. **`$DSH_HOME` 残留** —— 上次跑过会留下已注册条目，`add` 会报
   "already registered"。重新开始前删掉临时 `DSH_HOME`（见清理步骤）。
5. **一个仓库 = 一个条目。** 同一仓库不能注册两条（path 唯一），换
   `--name` 也不行。先 remove。
6. **上游仓库需要 git 用户身份** —— commit 前先配置
   `user.email` / `user.name`。
7. **平台路径格式。** Windows Git Bash：用 `cygpath -m` 转换，URL 用
   `file:///C:/...`；Linux / macOS：直接绝对路径（`/tmp/...`）和
   `file:///tmp/...`。
8. **`git init -b main` 需要 git ≥ 2.28**（2019 年发布）。旧版本用
   `git init && git symbolic-ref HEAD refs/heads/main`。
9. **跑的是编译产物** —— 流程使用 `lib/`；改过 `src/` 后先
   `npm run build` 再验证。
10. **安装时归一化会原地修改克隆里的 SKILL.md**（补 description / 修
    非法 name），克隆工作区因此是"脏"的。旧版本中这会让
    `git pull --ff-only`（分支 pin）和漂移恢复（tag/commit pin）报
    `Your local changes would be overwritten` 而失败。现在 `update` 会先
    打印 `⚠ discarding local changes in nexus-managed clone` 丢弃本地
    改动再继续——归一化产物在 pull 后会重新生成，终态不变。克隆是
    nexus 管理的，请勿手动编辑。
11. **脏克隆也会阻塞你手动执行的 git 命令。** C 步的
    `git checkout FETCH_HEAD` 在脏工作区上会被 git 拒绝（`Your local
    changes would be overwritten by checkout`）。正因如此，本文档的初始
    `SKILL.md` 带完整 frontmatter——不需要归一化的仓库克隆是干净的，
    手动模拟漂移才走得通。nexus 只保证自己的 `update` 不受脏工作区
    影响，不代你在克隆里执行任意 git 命令。

---

## 覆盖边界

本指南刻意不覆盖的内容：

- **真实 GitHub 网络** —— 本地 `file://` 远端与真实远端走同一套 git 语义，且不受网络波动影响。
- **DSH 运行时集成** —— Skills 通过 ~/.dsh/skills/ 中的 symlink 暴露，由官方 filesystem provider 发现。不再需要自定义 provider。新增 manifest 字段向后兼容（旧 manifest 没有 `commit` 也能加载，显示 `—`，下次 `update` 后自动补齐）。
- **Node 20 / 22 / 24 矩阵** —— CI（`.github/workflows/ci.yml`）在 push/PR 时跑完整质量门禁。
