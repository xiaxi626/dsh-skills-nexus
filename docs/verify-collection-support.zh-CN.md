# 验证集合仓库支持（P1）

本指南验证 **集合仓库支持** 改动：

- **A. 平铺扫描保守化** —— 集合仓库根目录的文档（`README.zh-CN.md`、`CONTRIBUTING.md`、`community-leaderboard.md` 等）永远不会被"假装安装"：发现阶段按前缀模式跳过文档型文件名；平铺 `*.md` 没有 frontmatter `name` **且**没有 `description` 的不算 skill。
- **B. `--subdir <path>`** —— 把集合仓库（`skills/<name>/SKILL.md` 布局，如 `trae-community/trae-skills`）中的某个子目录作为独立条目、独立克隆安装（独立克隆设计，v1）。
- **C. 防呆** —— 根目录解析不出任何 skill 的仓库会被拒绝并提示 `--subdir`；一次安装解析出超过 20 个 skill 需要确认（`--yes` 跳过，非 TTY 默认拒绝）。

以下操作都是安全的：不碰你真实的 `~/.dsh`、不访问任何 GitHub 仓库、当前仓库只被读取（或经 `npm run build` 重新编译）。所有临时状态都在专用临时目录里，最后统一删除。

## 前置条件

- Node.js ≥ 18，且 `git` 在 `PATH` 中
- 已 checkout 仓库并执行过 `npm install`
- 如果改过 `src/`，先 `npm run build`——下面的流程跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：111 个用例全部通过
npm run build       # tsc → lib/
npm run test:build  # 可选：把 src+test 编译到 test-dist/，无 loader 环境可跑
```

本次改动新增覆盖：

| 测试文件 | 验证内容 |
|---|---|
| `test/add.test.ts` | `--subdir` 安装（name/path 规则）、子目录缺失失败并清理、嵌套集合不带 `--subdir` 被拒绝、非法 subdir 值、大集合防呆 |
| `test/locator.test.ts` | 文档变体（`README.zh-CN.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md` 等）按前缀模式跳过 |
| `test/resolve.test.ts` | 无 frontmatter 的平铺 md 不是 skill；条目 `subdir` 解析；`previewSkills` |
| `test/args.test.ts` | `--subdir` 解析 + 缺值报错 |
| `test/repo-kind.test.ts` | `markerDir` 覆盖（插件标记在克隆根、skill 在子目录） |

---

## 第二部分 — 端到端验证

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。
步骤 `[a]`–`[h]` 覆盖本次改动的全部行为面。

### Windows（Git Bash / MINGW64）

```bash
# ---- 造上游集合仓库（模拟 trae-skills 布局）----
COLL="$(cygpath -m "$TEMP/nexus-col")"
DEMO="$(cygpath -m "$TEMP/nexus-col-demo")"
rm -rf "$COLL" "$DEMO"
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"              # 根目录文档——绝不能变成 skill
printf '# board\n' > "$COLL/community-leaderboard.md"
printf '# contributing\n' > "$COLL/CONTRIBUTING.md"
cd "$COLL" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/Downloads/dsh-skills-nexus                  # ← 改成你的路径
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] 全量 add：期望被拒绝 + --subdir 提示，exit=1 ---"
node lib/cli/index.js add "file:///$COLL"; echo "exit=$?"

echo "--- [b] --subdir 安装（独立克隆）---"
node lib/cli/index.js add "file:///$COLL" --subdir skills/alpha           # name=alpha
node lib/cli/index.js add "file:///$COLL" --subdir skills/beta --name beta

echo "--- [c] list：SUBDIR 列 ---"
node lib/cli/index.js list

echo "--- [d] resolveAll：只有 alpha-skill 和 beta-skill ---"
node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"

echo "--- [e] enable/disable 按条目（=按 subdir）独立生效 ---"
node lib/cli/index.js disable beta && node lib/cli/index.js list
node lib/cli/index.js enable beta

echo "--- [f] remove alpha：只删 alpha 的克隆 ---"
node lib/cli/index.js remove alpha && node lib/cli/index.js list

echo "--- [g] 大集合防呆（21 个 skill）---"
LARGE="$(cygpath -m "$TEMP/nexus-large")"
rm -rf "$LARGE"; mkdir -p "$LARGE"
for i in $(seq -w 1 21); do printf -- "---\nname: skill-$i\n---\nS\n" > "$LARGE/skill-$i.md"; done
cd "$LARGE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm large
cd "$PROJECT"
node lib/cli/index.js add "file:///$LARGE" --yes    # --yes 直接安装全部 21 个
node lib/cli/index.js list | grep nexus-large

echo "--- [h] 平铺 md 的身份规则（文档 vs 真 skill）---"
MIX="$(cygpath -m "$TEMP/nexus-mix")"
rm -rf "$MIX"; mkdir -p "$MIX/sub-skill"
printf 'plain text only, no frontmatter\n' > "$MIX/plain.md"       # ❌ 被过滤
printf -- '---\nname: with-name\n---\nbody\n' > "$MIX/with-name.md" # ✅ 有 name
printf 'no frontmatter either\n' > "$MIX/sub-skill/SKILL.md"        # ✅ SKILL.md 身份
cd "$MIX" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm mix
cd "$PROJECT"
node lib/cli/index.js add "file:///$MIX"
node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"
# 期望：with-name 和 sub-skill 出现，plain.md 不出现

# ---- 清理 ----
rm -rf "$COLL" "$DEMO" "$LARGE" "$MIX"
```

> `[g]` 不带 `--yes` 是交互式的：会打印
> `This repository yields 21 skills… [y/N]`。输入 `n` 中止（不注册），输入
> `y` 安装；非 TTY 环境下默认拒绝。

### Linux / macOS

命令与上面相同，仅路径改为绝对路径（无 `cygpath`）：

```bash
# ---- 造上游集合仓库 ----
COLL=/tmp/nexus-col
DEMO=/tmp/nexus-col-demo
rm -rf "$COLL" "$DEMO"
mkdir -p "$COLL/skills/alpha" "$COLL/skills/beta"
printf -- '---\nname: alpha-skill\n---\nA\n' > "$COLL/skills/alpha/SKILL.md"
printf -- '---\nname: beta-skill\n---\nB\n' > "$COLL/skills/beta/SKILL.md"
printf '# docs\n' > "$COLL/README.zh-CN.md"
printf '# board\n' > "$COLL/community-leaderboard.md"
printf '# contributing\n' > "$COLL/CONTRIBUTING.md"
cd "$COLL" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/dsh-skills-nexus                            # ← 改成你的路径
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] 全量 add：期望被拒绝 + --subdir 提示，exit=1 ---"
node lib/cli/index.js add "file://$COLL"; echo "exit=$?"

echo "--- [b] --subdir 安装（独立克隆）---"
node lib/cli/index.js add "file://$COLL" --subdir skills/alpha
node lib/cli/index.js add "file://$COLL" --subdir skills/beta --name beta

echo "--- [c] list：SUBDIR 列 ---"
node lib/cli/index.js list

echo "--- [d] resolveAll：只有 alpha-skill 和 beta-skill ---"
node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"

echo "--- [e] enable/disable 按条目（=按 subdir）独立生效 ---"
node lib/cli/index.js disable beta && node lib/cli/index.js list
node lib/cli/index.js enable beta

echo "--- [f] remove alpha：只删 alpha 的克隆 ---"
node lib/cli/index.js remove alpha && node lib/cli/index.js list

echo "--- [g] 大集合防呆（21 个 skill）---"
LARGE=/tmp/nexus-large
rm -rf "$LARGE"; mkdir -p "$LARGE"
for i in $(seq -w 1 21); do printf -- "---\nname: skill-$i\n---\nS\n" > "$LARGE/skill-$i.md"; done
cd "$LARGE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm large
cd "$PROJECT"
node lib/cli/index.js add "file://$LARGE" --yes      # --yes 直接安装全部 21 个
node lib/cli/index.js list | grep nexus-large

echo "--- [h] 平铺 md 的身份规则（文档 vs 真 skill）---"
MIX=/tmp/nexus-mix
rm -rf "$MIX"; mkdir -p "$MIX/sub-skill"
printf 'plain text only, no frontmatter\n' > "$MIX/plain.md"
printf -- '---\nname: with-name\n---\nbody\n' > "$MIX/with-name.md"
printf 'no frontmatter either\n' > "$MIX/sub-skill/SKILL.md"
cd "$MIX" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm mix
cd "$PROJECT"
node lib/cli/index.js add "file://$MIX"
node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"
# 期望：with-name 和 sub-skill 出现，plain.md 不出现

# ---- 清理 ----
rm -rf "$COLL" "$DEMO" "$LARGE" "$MIX"
```

---

## 每一步应该输出什么

| 步骤 | 期望输出 | 含义 |
|---|---|---|
| `[a]` 全量 add | `No installable SKILL.md content…` + `--subdir <path>` 提示，exit 1 | 嵌套集合被拒绝，而不是"假装安装" |
| `[b]` subdir add | `Added skill "alpha"` 且 `subdir: skills/alpha`，克隆在 `…-alpha` | 每个 subdir 独立克隆；name 取末段 |
| `[c]` list | SUBDIR 列显示 `skills/alpha` / `skills/beta` | 条目记录了 subdir |
| `[d]` resolveAll | 只有 `alpha-skill` + `beta-skill` | 根目录文档（README.zh-CN.md 等）不是 skill |
| `[e]` disable/enable | `beta` 单独 off/on，`alpha` 不受影响 | 按条目（=按 subdir）可见性 |
| `[f]` remove | `Removed "alpha" and deleted …-alpha/`，beta 保留 | 独立克隆，零连坐 |
| `[g]` 大集合防呆 | 不带 `--yes`：提示后中止；带 `--yes`：21 个 skill 注册 | 双向都正确 |
| `[h]` 平铺 md 规则 | `with-name` + `sub-skill` 出现，`plain.md` 不出现 | 无 frontmatter 的平铺 md ≠ skill；SKILL.md 永远算 |

注意：`resolveAll` 会列出当前 `$DSH_HOME` 里**所有**已注册条目，所以 `[g]` 之后会看到 21 个 `skill-*`——这是预期行为。

---

## 实践中踩过的坑

1. **同一个 `$DSH_HOME` 会累积条目** —— `[b]`–`[h]` 共用同一个演示
   `DSH_HOME`，后面的 `resolveAll`/`list` 输出会包含前面步骤注册的条目。
   这是预期；断言时按名字过滤，不要按总数。
2. **`[g]` 不带 `--yes` 是交互式的** —— TTY 下询问 `[y/N]`；非 TTY 默认
   拒绝并打印 `Aborted.`（不注册）。脚本化运行请用 `--yes`。
3. **`--subdir` 路径校验** —— 前导 `/`、`..`、空段在克隆前被拒绝；子目录
   不存在则在克隆后被拒绝并清理克隆。
4. **同一仓库可用不同 `--subdir` 安装多次** —— 每次安装是独立条目
   （name = subdir 末段，path = `repo-subdir`），不冲突；重复安装**同一个**
   subdir 会被拒绝（name/path 已注册）。
5. **平台路径** —— Windows Git Bash：`cygpath -m` + `file:///C:/...`；
   Linux / macOS：直接绝对路径 + `file:///tmp/...`。
6. **`git init -b main` 需要 git ≥ 2.28** —— 旧版本用
   `git init && git symbolic-ref HEAD refs/heads/main`。
7. **跑的是编译产物** —— 流程使用 `lib/`；改过 `src/` 后先
   `npm run build` 再验证。

---

## 覆盖边界

- **真实 GitHub 网络** —— 本地 `file://` 远端与真实远端走同一套 git 语义。
  对真实的 `trae-community/trae-skills` 应表现一致（12 个 skill 在 `skills/`
  下，根目录文档被过滤）。
- **P2 共享克隆设计** —— 未实现（v1 是独立克隆）；权衡与两个隐藏坑
  （共享判定键、锁的归属）见 [docs/subdir-design.md](docs/subdir-design.md)。
- **DSH 运行时集成** —— provider 的 `list()` / `get()` 未改动；`subdir` 是
  新增的可选 manifest 字段（旧 manifest 正常加载）。
- **Node 18 / 20 / 22 矩阵** —— CI 在 push/PR 时跑完整质量门禁。
