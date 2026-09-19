# 验证 `doctor` 命令（P0）

本指南验证 **`doctor`** 命令——一个只读、默认离线的 nexus 状态全量体检：

- `doctor` 会检查 manifest、两个根目录（`repos/`、`skills/`）、每个条目的
  symlink、遗留的孤立克隆 / 软链，以及每个克隆的 `.git`，然后打印对齐的报告，
  并以 **0**（干净）、**1**（至少一个 error）或 **2**（用法错误）退出。
- `--json` 输出稳定的机器可读契约（`version: 1`）；`--updates` 额外把**分支
  pin** 的条目与其远程比对（联网）；`--quiet` 在无 error 时不打印任何内容
  （便于 CI）。
- `doctor` **不改变任何状态**——绝不写 manifest、克隆或 symlink，也**不接入**
  插件 `apply()`（`apply()` 仍是空操作）。

> **Shell 警告——Windows 用户请在 Git Bash（MINGW64）里跑下面的流程，不要用
> PowerShell。** 以下代码块全是 POSIX / Bash 语法，切勿粘贴进 PowerShell 终端。
> 所有命令都用绝对路径或 `git -C <dir>`，并借一个 `nexus()` shell 函数调用 CLI
> ——全程不 `cd` 进你的项目，因此不会污染工作区。

以下操作都是安全的：使用位于临时目录下的隔离 `DSH_HOME`，用本地 `file://`
远程代替 GitHub（本地检查不联网），且绝不触碰你真实的 `~/.dsh`。最后统一删除
临时目录。

## 前置条件

- Node.js ≥ 20，且 `git` 在 `PATH` 中
- 已 checkout 仓库并执行过 `npm install`（测试依赖 `node_modules` 里的 `tsx`）
- 如果改过 `src/`，先 `npm run build`——下面的流程跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
npm run test:build  # 可选：把 src+test 编译到 test-dist/，无 loader 环境可跑
```

测试套件绝不碰你的真实环境：每个测试文件都使用临时 `DSH_HOME` + `mkdtemp`
目录，由 `after()` 钩子自动清理。

| 测试文件 | 验证内容 |
|---|---|
| `test/doctor.test.ts` | 全新安装全 ok（exit 0）；健康安装；断链 → `missing-target`（exit 1）且 orphan-link 不重复上报；orphan-repo / orphan-link / dangling-link；损坏 manifest；**损坏 manifest 时抑制 orphan 检查（不产生批量误删的误报）**；**畸形条目被结构化上报、绝不抛穿**；`.corrupt-` 备份；缺 `.git`；`--json` version-1 契约；`--quiet`；用法错误（exit 2）；`parseDoctorArgs`；`formatHuman` |
| `test/health.test.ts` | `diagnoseEntry`（`ok` / `disabled` / `missing-target`）；`findOrphanRepos` / `findOrphanLinks` 三分类（`orphan-link` / `dangling-link` / `unreadable-link`）；`checkHealth`；`formatWarning` |

上表加粗的两条 `doctor.test.ts` 用例是边界保护规则的回归锚点：当 manifest
不可读时，克隆与软链的归属**无法确认**，此时 `doctor` 必须**跳过** orphan 检查
（标 `warn`、不给删除提示），而不是把每个对象都判为待删。

---

## 第二部分 — 端到端验证

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。每个场景都从
已知状态开始；有破坏性的场景会显式重建状态。

### Windows（Git Bash / MINGW64）

```bash
PROJECT=~/Downloads/dsh-skills-nexus                 # ← 改成你的路径（结尾不带斜杠）
nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }

UP="$(cygpath -m "$TEMP/demo")"                       # 上游仓库目录名为 "demo"
HOME_DEMO="$(cygpath -m "$TEMP/nexus-doctor-home")"
rm -rf "$UP" "$HOME_DEMO"                             # 清掉上次残留
export DSH_HOME="$HOME_DEMO"
URL="file:///$UP"

# ---- 造一个本地上游仓库（代替 GitHub）----
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥ 2.28
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m init

# ---- S1）全新安装：DSH_HOME 为空 → 全 ok，exit 0 ----
nexus doctor; echo "exit=$?"

# ---- S2）健康安装 ----
nexus add "$URL" --name demo
nexus doctor; echo "exit=$?"                          # 全 ok，exit 0
nexus doctor --quiet; echo "exit=$?"                  # 静默，exit 0
nexus doctor --json | head -n 5                       # "version": 1, "checks": [ … ]
nexus doctor foo; echo "exit=$?"                      # 用法错误，exit 2
nexus doctor --json=x; echo "exit=$?"                 # 用法错误，exit 2

# ---- S3）orphan-repo：无条目引用的克隆（warn，exit 0）----
mkdir -p "$DSH_HOME/skills-nexus/repos/leftover"
nexus doctor; echo "exit=$?"                          # orphan-repo warn，exit 0
rmdir "$DSH_HOME/skills-nexus/repos/leftover"

# ---- S4）missing-target：删掉克隆、保留条目 + symlink（error，exit 1）----
rm -rf "$DSH_HOME/skills-nexus/repos/demo"
nexus doctor; echo "exit=$?"                          # symlinks FAIL + git-sanity warn；orphan-link 保持为空
# 通过重新注册恢复（update 无法重建被彻底删除的克隆——见「坑」）
nexus remove demo --yes
nexus add "$URL" --name demo

# ---- S5）损坏 manifest：文件不可读（error，exit 1；orphan 检查被跳过）----
MANIFEST="$DSH_HOME/skills-nexus/manifest.json"
cp "$MANIFEST" "$MANIFEST.bak"
printf '{ not json' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # manifest FAIL；orphan-repo/orphan-link = warn（未扫描，计为 2 个 warning）；无任何删除提示
mv "$MANIFEST.bak" "$MANIFEST"

# ---- S6）manifest 漂移：manifest 合法但为空，而克隆 + symlink 仍在 ----
printf '{"version":1,"skills":[]}' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # orphan-repo + orphan-link warn，exit 0

# ---- 清理 ----
rm -rf "$UP" "$HOME_DEMO"
unset DSH_HOME
```

### Linux / macOS

```bash
PROJECT=~/dsh-skills-nexus                            # ← 改成你的路径（结尾不带斜杠）
nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }

UP=/tmp/nexus-doctor/demo                             # 上游仓库目录名为 "demo"
HOME_DEMO=/tmp/nexus-doctor/home
rm -rf /tmp/nexus-doctor
export DSH_HOME="$HOME_DEMO"
URL="file://$UP"

# ---- 造一个本地上游仓库（代替 GitHub）----
mkdir -p "$UP"
git -C "$UP" init -b main                             # git ≥ 2.28；更旧版本：git init && git -C "$UP" symbolic-ref HEAD refs/heads/main
git -C "$UP" config user.email t@t
git -C "$UP" config user.name t
printf -- '---\nname: demo\ndescription: demo skill\n---\n# demo\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m init

# ---- S1）全新安装：DSH_HOME 为空 → 全 ok，exit 0 ----
nexus doctor; echo "exit=$?"

# ---- S2）健康安装 ----
nexus add "$URL" --name demo
nexus doctor; echo "exit=$?"                          # 全 ok，exit 0
nexus doctor --quiet; echo "exit=$?"                  # 静默，exit 0
nexus doctor --json | head -n 5                       # "version": 1, "checks": [ … ]
nexus doctor foo; echo "exit=$?"                      # 用法错误，exit 2
nexus doctor --json=x; echo "exit=$?"                 # 用法错误，exit 2

# ---- S3）orphan-repo：无条目引用的克隆（warn，exit 0）----
mkdir -p "$DSH_HOME/skills-nexus/repos/leftover"
nexus doctor; echo "exit=$?"                          # orphan-repo warn，exit 0
rmdir "$DSH_HOME/skills-nexus/repos/leftover"

# ---- S4）missing-target：删掉克隆、保留条目 + symlink（error，exit 1）----
rm -rf "$DSH_HOME/skills-nexus/repos/demo"
nexus doctor; echo "exit=$?"                          # symlinks FAIL + git-sanity warn；orphan-link 保持为空
nexus remove demo --yes
nexus add "$URL" --name demo

# ---- S5）损坏 manifest：文件不可读（error，exit 1；orphan 检查被跳过）----
MANIFEST="$DSH_HOME/skills-nexus/manifest.json"
cp "$MANIFEST" "$MANIFEST.bak"
printf '{ not json' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # manifest FAIL；orphan-repo/orphan-link = warn（未扫描，计为 2 个 warning）；无任何删除提示
mv "$MANIFEST.bak" "$MANIFEST"

# ---- S6）manifest 漂移：manifest 合法但为空，而克隆 + symlink 仍在 ----
printf '{"version":1,"skills":[]}' > "$MANIFEST"
nexus doctor; echo "exit=$?"                          # orphan-repo + orphan-link warn，exit 0

# ---- 清理 ----
rm -rf /tmp/nexus-doctor
unset DSH_HOME
```

---

## 第三部分 — `--updates`（尊重版本锁）

`--updates` 是唯一的联网检查。它把每个**分支 pin** 条目记录的 `commit` 与远程
tip（`git ls-remote`）比对。**tag/commit pin**（detached HEAD）是刻意的固定点：
会被报为 `locked`（info），绝不报「落后」。`--updates` 的结果都是 `info` 级
——既不计入 errors/warnings，也不改变退出码。

配合第二部分的本地 `file://` 远程，这一段完全离线可复现：

```bash
# （状态：demo 已按分支 main 重新添加，上游未变动）
nexus doctor --updates; echo "exit=$?"    # updates ok——本地 == 远程，exit 0

# 推进上游分支，再检查
printf -- '---\nname: demo\ndescription: v2\n---\n# demo v2\n' > "$UP/SKILL.md"
git -C "$UP" add .
git -C "$UP" commit -m second
nexus doctor --updates; echo "exit=$?"    # updates "update"——behind-remote（info），exit 仍为 0
nexus update demo                          # 快进并重新盖章版本锁
nexus doctor --updates; echo "exit=$?"    # 回到 ok
```

tag pin 则走 `locked` 分支：

```bash
git -C "$UP" tag v1.0.0
nexus remove demo --yes
nexus add "$URL#v1.0.0" --name demo
nexus doctor --updates                     # updates：demo → locked（info），绝不「落后」
```

对真实 GitHub 仓库行为完全一致，只是远程不同。

---

## 读懂报告

### 检查项（按报告顺序）

| 检查 id | 检查内容 |
|---|---|
| `manifest` | `manifest.json` 是否存在、可否解析、`version`/`skills` 结构与逐条结构；遗留的 `.corrupt-` 备份 |
| `roots` | `repos/` 与 `skills/` 是否存在且可读 |
| `symlinks` | 每个条目的 symlink 是否解析到存在的目录 |
| `orphan-repo` | `repos/` 下无条目引用的克隆目录 |
| `orphan-link` | 指向 `repos/` 但无条目认领的 symlink |
| `git-sanity` | 每个克隆是否仍有 `.git` |
| `updates` | （仅 `--updates`）分支 pin 与其远程的比对 |

### 状态 → 标签 → 计数

| 状态 | 人类可读标签 | 计入 | 影响退出码 |
|---|---|---|---|
| `ok` | `ok` | — | 否 |
| `warn` | `warn` | `warnings` | 否 |
| `error` | `FAIL` | `errors` | 是 → exit 1 |
| `update-available` | `update` | `updates` | 否 |

退出码：**0** = 无 error，**1** = 至少一个 error，**2** = 用法错误（未知选项、
位置参数，或给布尔 flag 带内联值如 `--json=x`）。

### 问题 code

| code | 严重度 | 含义 | 建议修复 |
|---|---|---|---|
| `corrupt-manifest` | error | `manifest.json` 无法解析、`version` 不对，或条目畸形 | 检查该文件；`.corrupt-` 备份（若有）保存了最后的原始内容 |
| `corrupt-backup` | warn | 存在 `manifest.json.corrupt-<ts>` 备份 | 重新添加 skill 后可安全删除 |
| `root-unreadable` | error | `repos/` 或 `skills/` 存在但不可读 | 修复目录权限 |
| `missing-target` | error | 某条目的 symlink 指向不存在的目录 | `remove <name>` 后重新 `add` |
| `orphan-repo` | warn | `repos/` 下无条目引用的克隆 | 删除该遗留克隆，或重新添加 |
| `orphan-link` | warn | 指向 `repos/` 但无条目认领的 symlink | 删除它，或重新添加 |
| `dangling-link` | error | 指向 `repos/`、目标已消失且无条目认领的 symlink | 删除该悬空 symlink |
| `unreadable-link` | warn | `readlink` 失败，归属无法确认 | 手动检查——**切勿**盲目删除 |
| `orphan-check-skipped` | warn | manifest 不可读，孤立对象扫描被跳过 | 先修复 manifest（见 `corrupt-manifest`） |
| `missing-git` | warn | 某克隆缺少 `.git` | `remove <name>` 后重新 `add` |
| `behind-remote` | info | 分支 pin 落后于远程（仅 `--updates`） | `update <name>` |
| `locked` | info | tag/commit pin，刻意不跟踪远程（仅 `--updates`） | 无——这是预期行为 |

### `--json` 结构（稳定契约，`version: 1`）

```json
{
  "version": 1,
  "checks": [
    { "id": "manifest", "status": "ok", "detail": "1 entry (version 1)", "issues": [] },
    { "id": "symlinks", "status": "error", "issues": [
        { "severity": "error", "code": "missing-target", "name": "demo",
          "fix": "dsh-skills-nexus update demo" }
    ] }
  ],
  "summary": { "errors": 1, "warnings": 0, "updates": 0 }
}
```

问题**内联**在各自的 check 下（没有顶层 `issues` 数组）。`severity` 为
`error` / `warn` / `info`；`status` 为 `ok` / `warn` / `error` /
`update-available`。消费者应以 `version` 为准，并把未知 code 视为向前兼容。

---

## 实践中遇到的坑

1. **跑编译后的 CLI**——本流程用的是 `lib/`；改过 `src/` 后先 `npm run build`。
2. **`update` 不会重建被彻底删除的克隆。** 它能对分支 pin 快进、对漂移的
   tag/commit pin 恢复，但若 `repos/<name>` 整个没了就会报错。要修复被删的
   克隆，请 `remove <name>` 再 `add`——这也是 S4 这样恢复状态的原因。
3. **删掉克隆会同时触发两个检查**——`symlinks`（`missing-target`，error）
   *和* `git-sanity`（`missing-git`，warn），因为二者看的是同一个缺失目录。
   `orphan-link` 会刻意为空：该软链仍被在世条目认领，不是孤立对象（不重复上报）。
4. **损坏 manifest ≠ 缺失 manifest。** 缺失是干净的「尚未安装」（全 ok）；
   存在但不可读则是 error，且由于此时条目归属未知，orphan 检查会被**跳过**
   （warn、无删除提示），而不是把每个健康克隆/软链都判为待删。
5. **注册名是你传给 `--name` 的值**（这里是 `demo`）；克隆目录名是仓库 slug
   （同样是 `demo`，因为上游目录就叫 `demo`）。用 `nexus list` 可确认两者。
6. **平台路径格式。** Windows Git Bash：用 `cygpath -m` 转换并用
   `file:///C:/...` URL。Linux / macOS：用普通绝对路径与 `file:///...` URL。
7. **`git init -b main` 需要 git ≥ 2.28**（2019）。更旧版本：
   `git init && git -C "$UP" symbolic-ref HEAD refs/heads/main`。
8. **残留的 `$DSH_HOME`**——上一次运行会留下条目。重新开始前先删掉临时 home
   （见清理）。

---

## 覆盖边界

本指南**不**覆盖（皆为刻意取舍）：

- **orphan-link 的全部子类**——`unreadable-link` 与 `dangling-link` 需要手工
  构造的「野」symlink，在 shell 里跨平台创建很脆弱；改由 `test/doctor.test.ts`
  与 `test/health.test.ts` 做确定性覆盖。
- **真实 GitHub 网络**——本地 `file://` 远程走的是同一条 `git ls-remote` 路径，
  却没有网络抖动。
- **插件运行时**——`doctor` 是纯 CLI 命令；插件 `apply()` 仍是空操作，绝不调用它。
- **Node 20 / 22 / 24 矩阵**——CI（`.github/workflows/ci.yml`）在 push/PR 上跑
  完整质量门禁。
