# 验证项目级技能作用域

[English](verify-project-skills.md)

> **Shell 提醒：** 下面的 `bash` 代码块面向 Windows Git Bash 或 Linux/macOS Bash，不要粘进 PowerShell/cmd。请在仓库根目录打开终端，整块执行。脚本只在子 shell 里切换目录，并使用隔离的 `DSH_HOME`。

项目作用域管理的是「随项目走的技能」：`<projectRoot>/.dsh/skills` 下的链接。DSH filesystem provider **先**扫描这个目录，再扫描用户级根，因此项目里的同名技能会覆盖全局技能；nexus 不需要 manifest、克隆或复制，provider 会跟随链接。

本指南验证：

- `list --project`、`link --project <dir>`、`remove --project <name>...`、`doctor --project`；
- `enable --project` / `disable --project`（链接通道），以及用 `--files` 在 `.dsh/skills` 与 `.dsh/skills-disabled` 之间移动真实目录；
- 已登记工作区块：`GET /workspaces/list`、`GET /workspace/skills`、`POST /workspace/toggle`；
- `list --all`（仅供人读的双作用域表，带 `overrides` / `shadowed` 标记）；
- 手填项目文件夹的四条 HTTP 路由与面板区块；
- 不变量：**不写 manifest、不复制/克隆、绝不删除用户文件**。

## 项目作用域是什么、不是什么

| | 全局（默认） | 项目作用域（`--project`） |
|---|---|---|
| 条目位置 | `~/.dsh/skills/<name>` | `<projectRoot>/.dsh/skills/<name>` |
| 目标 | nexus 克隆，或外部目录 | 用户指定的任意目录 |
| 状态 | `manifest.json` 记录来源/版本/归属 | **无状态**——文件系统即真相 |
| 命令 | 完整生命周期 | `list` / `link` / `remove` / `doctor` / `enable` / `disable` |
| 写入 | manifest、克隆、链接 | 链接；`--files` 模式下是一次真实目录的 `rename` |

`--project` 不支持：`add`、`import`、`update`、`export`。`remove --project` 只接受精确链接名（不支持通配，也不支持 `--group`），`enable` / `disable` 同样只接受精确名；`--files` 还额外拒绝 `--group`，因为两者都按精确名定位。

## 前置条件与两次构建

- Node.js >= 20，`PATH` 中有 git；Windows 用 Git Bash。
- 在仓库根目录完成依赖安装。
- `npm run build` 编译 CLI/服务端半边；`npm run build:client` 另行生成 `lib/client.js` 与 `lib/client-types/`。不跑后者，面板区块不会更新。

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  npm run build
  npm run build:client
  npm run typecheck
  npm run lint
  npm run test:build
)
```

所有命令都应以 0 退出。检查已提交产物是否新鲜：`git diff --exit-code -- lib/`。不要手改生成文件。

## 自动化回归测试

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  node --import tsx --import ./test/register-css.mjs --test \
    test/project.test.ts test/project-files.test.ts \
    test/cli-project.test.ts \
    test/workspaces.test.ts test/workspace-routes.test.ts \
    test/args.test.ts test/api.test.ts test/client-api.test.ts \
    test/panel-render.test.tsx test/panel-workspaces.test.tsx \
    test/completions.test.ts
)
```

| 测试文件 | 覆盖内容 |
|---|---|
| `project.test.ts` | `detectProjectRoot`（目录型与文件型 `.git`、回退 cwd）；列表（空根、链接、用户文件、可恢复目标的悬空链接）；三种布局的命名与非 ASCII 回退；`replace` / `unchanged` / `collision` / 同名冲突计划；执行后重新计划；删除拒绝真实目录；路径穿越拒绝；Windows UNC 拒绝 |
| `project-files.test.ts` | `setProjectFilesEnabled` / `listProjectFiles`：disable → enable 往返、`already-*` 语义、`not-found`、路径穿越拒绝、两棵根同名独立可见、另一位置被占用时的 `collision` |
| `cli-project.test.ts` | 进程级链路：cwd 根检测、`link --project` → `list --project` → `remove --project`、JSON 纯净性、退出码、不产生 manifest、用户文件被拒、悬空 `doctor` 警告、`list --all`、错误显式根、来源式 flag 被拒、UNC 被拒；`--files` 移动真实目录且拒绝链接 |
| `workspaces.test.ts` | `workspaceRegistryOf` 在缺失/畸形 `ctx` 下的行为；`listWorkspaces` 行归一化；`resolveWorkspaceTarget` 拒绝绝对路径、未登记路径、已消失的行与符号链接化的 `.dsh` 层级 |
| `workspace-routes.test.ts` | 三条路由经假 request/response：不可用分支、`workspace` 查询、toggle 请求体、错误状态映射 |
| `args.test.ts` | `--project` / `--project-root` / `--all` / `--files` 解析、「root 必须配 project」规则、`--files` 必须配 `--project`、互斥、项目模式下的 flag/通配拒绝 |
| `api.test.ts` | 手填文件夹四条路由：root 校验、loopback 与来源校验、预览与 `202` job、`confirm-required`、`404 not-found`、`409 not-a-link`/`collision`、`400 invalid-name`、UNC 拒绝 |
| `client-api.test.ts` | `projectList` 的 URL 编码、`projectLink` 预览/job 请求体、`projectRemove` 的 confirm 标志 |
| `panel-render.test.tsx` | 项目区块渲染 root 输入与受控表单；`link` 行有 `remove`，`user files` 行永远没有；悬空行显示 `dangling` 徽标 |
| `panel-workspaces.test.tsx` | 已登记工作区块在最前、带 `<hr/>` 分隔；手填区块与提示原文未变；`WorkspaceSkillRow` 只提供开关（`active dir` / `disabled dir`） |
| `completions.test.ts` | 四个补全模板都提供 `--project` / `--project-root` / `--all` / `--files`；位置计数会跳过 `--project-root` 的值 |

## 隔离的 CLI 演练

脚本会创建一个临时项目（带 `.git` 标记）、两个来源技能目录和一个隔离的 `DSH_HOME`，然后驱动全部项目命令。每个检查点打印一行 `PASS`，最后打印 `cleaned`。

```bash
(
  set -e
  PROJECT="$(pwd)"
  BASE="${TMPDIR:-/tmp}/nexus-project-verify-$$"
  if command -v cygpath >/dev/null 2>&1; then BASE="$(cygpath -m "$BASE")"; fi
  export DSH_HOME="$BASE/home"
  PROJ="$BASE/proj"
  SRC="$BASE/src/my-skill"
  SRC2="$BASE/src/second-skill"
  nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }
  expect_fail() { if "$@" >/dev/null 2>&1; then echo "FAIL: expected a non-zero exit: $*"; exit 1; fi; }

  rm -rf "$BASE"
  mkdir -p "$PROJ/.git" "$SRC" "$SRC2"
  printf -- '---\nname: my-skill\ndescription: demo\n---\n# my-skill\n' > "$SRC/SKILL.md"
  printf -- '---\nname: second-skill\ndescription: demo\n---\n# second-skill\n' > "$SRC2/SKILL.md"

  # S1) 空项目正常列出
  nexus list --project --project-root "$PROJ" | grep -q 'No project skills in'
  echo 'PASS S1 empty project lists cleanly'

  # S2) 把目录链接进 <project>/.dsh/skills
  nexus link --project "$SRC" --project-root "$PROJ" --json > "$BASE/link.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.version!==1||r.results[0].status!=="link"||r.summary.linked!==1){console.error(r);process.exit(1)}' "$BASE/link.json"
  test -d "$PROJ/.dsh/skills/my-skill"
  echo 'PASS S2 link --project creates the project link'

  # S3) list --project 给出 kind/target（两种形态）
  nexus list --project --project-root "$PROJ" --json > "$BASE/list.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.entries.length!==1||r.entries[0].kind!=="link"||r.entries[0].dangling!==false){console.error(r);process.exit(1)}' "$BASE/list.json"
  nexus list --project --project-root "$PROJ" | grep -q '^link  my-skill'
  echo 'PASS S3 list --project reports KIND / NAME / TARGET'

  # S4) 用户文件会被列出，但绝不被删除
  mkdir -p "$PROJ/.dsh/skills/vendored"
  printf -- '---\nname: vendored\n---\n' > "$PROJ/.dsh/skills/vendored/SKILL.md"
  expect_fail nexus remove --project vendored --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/vendored/SKILL.md"
  echo 'PASS S4 remove --project refuses user files'

  # S5) 目标被删后链接悬空，doctor 给出警告
  nexus link --project "$SRC2" --project-root "$PROJ" --json > /dev/null
  rm -rf "$SRC2"
  nexus doctor --project --project-root "$PROJ" --json > "$BASE/doctor.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const c=r.checks[0]; if(c.id!=="project-links"||c.status!=="warn"||r.summary.warnings!==1){console.error(r);process.exit(1)}' "$BASE/doctor.json"
  echo 'PASS S5 doctor --project warns about a dangling link'

  # S6) 删除悬空链接即可清理
  nexus remove --project second-skill --project-root "$PROJ" --json > "$BASE/remove.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.results[0].status!=="removed"){console.error(r);process.exit(1)}' "$BASE/remove.json"
  test ! -e "$PROJ/.dsh/skills/second-skill"
  echo 'PASS S6 remove --project deletes only the link'

  # S7) 在项目 cwd 下，list --all 合并两个作用域
  ( cd "$PROJ" && node "$PROJECT/lib/cli/index.js" list --all ) | grep -q 'project root:'
  echo 'PASS S7 list --all joins project and global scopes'

  # S8) 不变量与项目专属 flag
  test ! -f "$DSH_HOME/skills-nexus/manifest.json"
  test -f "$SRC/SKILL.md"
  expect_fail nexus link --project "$SRC" --project-root "$PROJ" --force
  expect_fail nexus list --project-root "$PROJ"
  echo 'PASS S8 no manifest, target intact, project-only flags rejected'

  rm -rf "$BASE"
  echo 'cleaned'
)
```

预期结尾：

```text
PASS S1 empty project lists cleanly
PASS S2 link --project creates the project link
PASS S3 list --project reports KIND / NAME / TARGET
PASS S4 remove --project refuses user files
PASS S5 doctor --project warns about a dangling link
PASS S6 remove --project deletes only the link
PASS S7 list --all joins project and global scopes
PASS S8 no manifest, target intact, project-only flags rejected
cleaned
```

平台行为说明：

- Windows 上链接是 NTFS junction；`test -d` 会跟随它，`remove --project` 只删 junction，不碰目标。
- Windows 上 UNC 来源（例如 \\server\share\...）在任何文件系统调用之前就被拒绝，错误信息会说明 junction 需要本地绝对路径。演练脚本用的都是本地目录，因此该守卫由聚焦测试覆盖，而不是脚本。
- POSIX 上同样步骤走普通目录符号链接；悬空符号链接可经 `readlink` 恢复旧目标，`list --project` 因此仍能显示它。

### 查看器与开关的补充检查

脚本早于项目查看器。要查看它，写入根 `$PROJ/SKILL.md`（合法的
`name`/`description`）后重跑 `list --project`：`Folder skills` 区会显示解析后的名称与
描述，而不只是文件名。要验证开关，先链接一个来源，再执行
`disable --project <name> --json`；断言 `.dsh/skills-disabled/<name>` 存在且目标目录的
`SKILL.md` 原样未动，然后 `enable --project <name>` 应恢复活动链接。

### 真实目录开关（`--files`）

`--files` 是第二条启停通道：它只在两棵项目根之间移动**真实目录**，并拒绝链接（链接属于链接通道）。沿用上面的 ***$PROJ***：

```bash
(
  set -e
  PROJECT="$(pwd)"
  BASE="${TMPDIR:-/tmp}/nexus-files-verify-$$"
  if command -v cygpath >/dev/null 2>&1; then BASE="$(cygpath -m "$BASE")"; fi
  export DSH_HOME="$BASE/home"
  PROJ="$BASE/proj"
  nexus() { node "$PROJECT/lib/cli/index.js" "$@"; }
  expect_fail() { if "$@" >/dev/null 2>&1; then echo "FAIL: expected a non-zero exit: $*"; exit 1; fi; }

  mkdir -p "$PROJ/.git" "$PROJ/.dsh/skills/real-skill"
  printf -- '---\nname: real-skill\ndescription: demo\n---\n' > "$PROJ/.dsh/skills/real-skill/SKILL.md"

  # F1) disable --files 把真实目录移入 skills-disabled
  nexus disable --project --files real-skill --project-root "$PROJ"
  test ! -e "$PROJ/.dsh/skills/real-skill"
  test -f "$PROJ/.dsh/skills-disabled/real-skill/SKILL.md"
  echo 'PASS F1 disable --files moves a real directory'

  # F2) enable --files 再移回
  nexus enable --project --files real-skill --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/real-skill/SKILL.md"
  echo 'PASS F2 enable --files restores it'

  # F3) 不加 --files 时真实目录属于用户内容：拒绝、退出码 1
  expect_fail nexus disable --project real-skill --project-root "$PROJ"
  test -f "$PROJ/.dsh/skills/real-skill/SKILL.md"
  echo 'PASS F3 link mode still refuses real directories'

  rm -rf "$BASE"
  echo 'cleaned'
)
```

预期输出三行 `PASS` 与一行 `cleaned`。

## 面板验收清单

需要挂载了插件的 DSH **web** 宿主（见[本地测试步骤](../README_CN.md#本地测试步骤)）。静态渲染由测试套件覆盖；下面是 UI 集成门禁。

1. 打开**设置 → Skills Nexus**。该 section 有两个页签：**全局技能**（默认）与**项目技能**。
2. 切到**项目技能**页签。文件夹输入为空时，页签显示 `enter a project folder to see its skills`，且**不发请求**。
3. 填入临时项目的绝对路径（例如 `D:\theme-port-skill`），点 **refresh**。**skills in this folder** 区显示解析后的 frontmatter 名称与描述，而不是只有 `SKILL.md`；**project skills root** 区列出 `.dsh/skills` 条目（没有则显示为空）。
4. 在 folder skill 行点 **link**。job 运行，folder 行变成 `linked`，project skills root 下出现对应链接行，带解析名称与绝对目标。
5. 把该链接行的 **Switch** 关掉：行变成 `disabled`，链接移到 `.dsh/skills-disabled`，目标目录仍然存在；再打开即移回。
6. 删除目标目录后再次 **refresh**：该行变成 `dangling` 徽标（warning 色调）。
7. 你自己放进 `.dsh/skills` 的真实目录显示 `user files` 徽标，**没有 Switch、没有 remove**。
8. 在 link 行点 **remove**：确认浮层写明只删链接；确认后该行消失，目标目录仍然存在。
9. 修改项目文件夹：旧列表立即清空（不会残留上一个项目的行）。
10. 在文件夹输入框**上方**的**已登记工作区（.dsh）**区块点 **load workspaces**。web 宿主下列表按 title 列出注册表里的工作区；随后的扫描针对该工作区**已登记**的路径——不在注册表里的路径无法在这里选中（请改用下方文件夹输入框）。
11. 选一个 `.dsh/skills` 里有真实目录的工作区。行显示 `active dir` 与 **Switch**，没有 remove 按钮——工作区通道从不删除用户内容。
12. 关掉该 Switch：行变成 `disabled dir`，目录出现在该工作区的 `.dsh/skills-disabled` 下；再打开即移回。链接不能在这里移动，因为只有真实条目才会成行。
13. 选一个完全没有 `.dsh` 的工作区：区块显示 `no real directories under the project skills root.`，这是空结果，不是错误。
14. 在 headless 宿主（没有 `@deepseek-ai/dsh-web-app`）上，**load workspaces** 返回 `available: false` 并给出说明；手填文件夹照常可用，且不会静默回退到未登记路径。

## HTTP 接口

手填项目文件夹使用四条路由；它们是面板内部管道，不是稳定机器接口（稳定接口是 CLI 的 `--json` 报告）。

| 路由 | Body / query | 返回 |
|---|---|---|
| `GET /skills-nexus/project/list` | `?root=<绝对路径>` | `{ projectRoot, folderSkills, entries }` |
| `POST /skills-nexus/project/link` | `{ root, dir }` | 同步计划 `{ projectRoot, source, results }` |
| `POST /skills-nexus/project/link` | `{ root, dir, confirm: true }` | `202 { data: { jobId } }`；轮询 `GET /job?id=` |
| `POST /skills-nexus/project/toggle` | `{ root, name, enabled }` | `{ projectRoot, name, enabled, status }` |
| `POST /skills-nexus/project/remove` | `{ root, name, confirm: true }` | `{ projectRoot, name, status: 'removed' }` |

四条路由都要求同源且 socket 为 loopback。`root` 不是已存在目录返回 `400 invalid-root`；name 含路径分隔符返回 `400 invalid-name`；真实目录/文件返回 `409 not-a-link`（另一位置被占用时返回 `409 collision`）；缺字段返回 `400 missing-field`；Windows 下 UNC 来源返回 `400 unsupported-source`。

已登记工作区块使用另外三条路由。它们在构造上就是特权通道：目标必须是宿主注册表已知的路径。

| 路由 | Body / query | 返回 |
|---|---|---|
| `GET /skills-nexus/workspaces/list` | — | `{ data: { available, items: [{ id, path, title, projectRoot, exists }] } }` |
| `GET /skills-nexus/workspace/skills` | `?workspace=<已登记路径>` | `{ data: { workspace, entries } }` |
| `POST /skills-nexus/workspace/toggle` | `{ workspace, name, enabled }` | `{ data: { workspace, name, enabled, status } }` |

宿主没有 workspace 注册表时，列表返回 `available: false` 与空 `items`，另外两条路由返回 `503 workspace-unavailable`；这里刻意不回退到任意路径。非绝对路径返回 `400 invalid-workspace`，注册表里没有该路径返回 `400 workspace-unregistered`，而项目根的 `.dsh` / `.dsh/skills` / `.dsh/skills-disabled` 任一层是符号链接或 junction 时返回 `409 unsafe-root`。注册表 `list()` 抛错返回 `500 registry-error`。

toggle 只移动**真实目录**：遇到链接仍返回 HTTP 200，但 `status` 是 `'not-files'` 而不是 `'enabled'` / `'disabled'`——链接属于 `/project/toggle`，客户端会把该判定作为行错误显示，而不是假装移动成功。

## 已知边界

- **无状态。** manifest 里没有 `projectRoot`，没有迁移，也没有「projectRoot 失效」故障类。目录本身就是记录。
- **链接是机器本地的。** 它记录绝对路径；把 `.dsh/skills/` 或 `.dsh/skills-disabled/` 下的链接提交进 git 对队友没有意义（Windows 上 git 还可能把 junction 当普通目录遍历）。纯 link 用法建议把两者加入 `.gitignore`；要共享就把真实文件 vendored 进去。
- **名字。** DSH 的目录名来自 `SKILL.md` 的 frontmatter；链接的**条目名**是文件系统键，优先取目录名（目录名不含可用 ASCII 字符时回退 frontmatter 名）。面板与 CLI 展示解析后的名称，扁平 `SKILL.md` 行不再匿名。
- **停用 = 移动链接。** 链接移到同级的 `.dsh/skills-disabled/`，目标与悬空状态都保留；停用同名项目技能会让全局同名技能重新可见。不会编辑任何 `SKILL.md`。
- **只按精确名删除。** `remove --project` 只接受名字，不接受通配或组前缀；这个拒绝是刻意的，把破坏面限制在单条链接上。
- **`list --all` 仅供人读。** 它合并两个数据集（文件系统链接与 manifest 条目），不属于 version-1 JSON 契约；机器读取请分别用 `list --json` 与 `list --project --json`。
- **Windows junction 目标。** junction 需要本地绝对路径；UNC 共享会被前置拒绝，而不是抛出原生 `EPERM`。
- **面板有两扇门。** 手填文件夹输入框按会话有效、不持久化（该客户端上下文只注入 `slots`，没有可读的根）；已登记工作区块读取宿主注册表，因此只在 DSH web profile 下有内容。两者都不持久化任何状态。

完整的命令与选项见 README 的[项目技能](../README_CN.md#项目技能)一节。
