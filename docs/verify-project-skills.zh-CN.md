# 验证项目级技能作用域

[English](verify-project-skills.md)

> **Shell 提醒：** 下面的 `bash` 代码块面向 Windows Git Bash 或 Linux/macOS Bash，不要粘进 PowerShell/cmd。请在仓库根目录打开终端，整块执行。脚本只在子 shell 里切换目录，并使用隔离的 `DSH_HOME`。

项目作用域管理的是「随项目走的技能」：`<projectRoot>/.dsh/skills` 下的链接。DSH filesystem provider **先**扫描这个目录，再扫描用户级根，因此项目里的同名技能会覆盖全局技能；nexus 不需要 manifest、克隆或复制，provider 会跟随链接。

本指南验证：

- `list --project`、`link --project <dir>`、`remove --project <name>...`、`doctor --project`；
- `list --all`（仅供人读的双作用域表，带 `overrides` / `shadowed` 标记）；
- 三条 HTTP 路由与面板区块；
- 不变量：**不写 manifest、不复制/克隆、绝不删除用户文件**。

## 项目作用域是什么、不是什么

| | 全局（默认） | 项目作用域（`--project`） |
|---|---|---|
| 条目位置 | `~/.dsh/skills/<name>` | `<projectRoot>/.dsh/skills/<name>` |
| 目标 | nexus 克隆，或外部目录 | 用户指定的任意目录 |
| 状态 | `manifest.json` 记录来源/版本/归属 | **无状态**——文件系统即真相 |
| 命令 | 完整生命周期 | 只有 `list` / `link` / `remove` / `doctor` |
| 写入 | manifest、克隆、链接 | 只有链接 |

`--project` 不支持：`add`、`import`、`update`、`export`、`enable`、`disable`。`remove --project` 只接受精确链接名（不支持通配，也不支持 `--group`）。

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
    test/project.test.ts test/cli-project.test.ts \
    test/args.test.ts test/api.test.ts test/client-api.test.ts \
    test/panel-render.test.tsx test/completions.test.ts
)
```

| 测试文件 | 覆盖内容 |
|---|---|
| `project.test.ts` | `detectProjectRoot`（目录型与文件型 `.git`、回退 cwd）；列表（空根、链接、用户文件、可恢复目标的悬空链接）；三种布局的命名与非 ASCII 回退；`replace` / `unchanged` / `collision` / 同名冲突计划；执行后重新计划；删除拒绝真实目录；路径穿越拒绝；Windows UNC 拒绝 |
| `cli-project.test.ts` | 进程级链路：cwd 根检测、`link --project` → `list --project` → `remove --project`、JSON 纯净性、退出码、不产生 manifest、用户文件被拒、悬空 `doctor` 警告、`list --all`、错误显式根、来源式 flag 被拒、UNC 被拒 |
| `args.test.ts` | `--project` / `--project-root` / `--all` 解析、「root 必须配 project」规则、互斥、项目模式下的 flag/通配拒绝 |
| `api.test.ts` | 三条路由：root 校验、loopback 与来源校验、预览与 `202` job、`confirm-required`、`404 not-found`、`409 not-a-link`、`400 invalid-name`、UNC 拒绝 |
| `client-api.test.ts` | `projectList` 的 URL 编码、`projectLink` 预览/job 请求体、`projectRemove` 的 confirm 标志 |
| `panel-render.test.tsx` | 项目区块渲染 root 输入与受控表单；`link` 行有 `remove`，`user files` 行永远没有；悬空行显示 `dangling` 徽标 |
| `completions.test.ts` | 四个补全模板都提供 `--project` / `--project-root` / `--all`；位置计数会跳过 `--project-root` 的值 |

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

## 面板验收清单

需要挂载了插件的 DSH **web** 宿主（见[本地测试步骤](../README_CN.md#本地测试步骤)）。静态渲染由测试套件覆盖；下面是 UI 集成门禁。

1. 打开**设置 → Skills Nexus**。该 section 有两个页签：**全局技能**（默认）与**项目技能**。
2. 切到**项目技能**页签。项目根输入为空时，页签显示 `enter the project root to list its skills`，且**不发请求**。
3. 填入临时项目的绝对路径，点 **refresh**。空的 `.dsh/skills` 显示 `no project skills yet — link a directory below.`
4. 粘贴技能目录路径，点 **preview**。计划为每个发现的技能列一行，带计划状态（`link` / `replace` / `unchanged` / `collision` / `invalid`）。此时磁盘上还没有任何变化。
5. 点 **link to project**。job 运行，列表刷新出 `link` 徽标与绝对目标。
6. 删除目标目录后再次 **refresh**：该行变成 `dangling` 徽标（warning 色调）。
7. 你自己放进 `.dsh/skills` 的真实目录显示 `user files` 徽标，**没有 remove 按钮**。
8. 在 link 行点 **remove**：确认浮层写明只删链接；确认后该行消失，目标目录仍然存在。
9. 修改项目根：旧列表立即清空（不会残留上一个项目的行）。

## HTTP 接口

面板与三条路由通信；它们是面板内部管道，不是稳定机器接口（稳定接口是 CLI 的 `--json` 报告）。

| 路由 | Body / query | 返回 |
|---|---|---|
| `GET /skills-nexus/project/list` | `?root=<绝对路径>` | `{ projectRoot, entries }` |
| `POST /skills-nexus/project/link` | `{ root, dir }` | 同步计划 `{ projectRoot, source, results }` |
| `POST /skills-nexus/project/link` | `{ root, dir, confirm: true }` | `202 { data: { jobId } }`；轮询 `GET /job?id=` |
| `POST /skills-nexus/project/remove` | `{ root, name, confirm: true }` | `{ projectRoot, name, status: 'removed' }` |

三条路由都要求同源且 socket 为 loopback。`root` 不是已存在目录返回 `400 invalid-root`；name 含路径分隔符返回 `400 invalid-name`；真实目录/文件返回 `409 not-a-link`；缺字段返回 `400 missing-field`；Windows 下 UNC 来源返回 `400 unsupported-source`。

## 已知边界

- **无状态。** manifest 里没有 `projectRoot`，没有迁移，也没有「projectRoot 失效」故障类。目录本身就是记录。
- **链接是机器本地的。** 它记录绝对路径；把 `.dsh/skills/` 下的链接提交进 git 对队友没有意义（Windows 上 git 还可能把 junction 当普通目录遍历）。纯 link 用法建议把 `.dsh/skills/` 加入 `.gitignore`；要共享就把真实文件 vendored 进去。
- **名字来自目录。** 技能按目录名识别，而不是 frontmatter `name`，因为 provider 就是这么识别的。目录名没有任何可用 ASCII 字符时才回退 frontmatter 名；两者都不可用才是 `invalid`。
- **只按精确名删除。** `remove --project` 只接受名字，不接受通配或组前缀；这个拒绝是刻意的，把破坏面限制在单条链接上。
- **`list --all` 仅供人读。** 它合并两个数据集（文件系统链接与 manifest 条目），不属于 version-1 JSON 契约；机器读取请分别用 `list --json` 与 `list --project --json`。
- **Windows junction 目标。** junction 需要本地绝对路径；UNC 共享会被前置拒绝，而不是抛出原生 `EPERM`。
- **面板的根是手填的。** 该客户端上下文只注入 `slots`，没有 workspace 服务可读项目根，所以输入框按会话有效、不持久化。

完整的命令与选项见 README 的[项目技能](../README_CN.md#项目技能)一节。
