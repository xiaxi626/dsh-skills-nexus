# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

**2026-08-27 · Docs · README 分层重构：精简根 README，架构与贡献指南外移至 docs/ 和 CONTRIBUTING**

- README 从 521 行精简至 266 行（-49%），README_CN 从 437 行精简至 196 行（-55%）。安装、使用、卸载、本地测试、轻量验证、注意事项等用户操作链完整保留在根 README 中，未拆散。
- 新增 `docs/ARCHITECTURE.md` / `.zh-CN.md`：架构概览（Mermaid 数据流图）、工作原理（pipeline + 设计要点）、SKILL.md 发现规则（3 种布局 + frontmatter 字段）、文件系统布局（两层目录设计 + 环境变量覆盖）从 README 外移至此。
- 新增 `CONTRIBUTING.md` / `.zh-CN.md`：项目结构（`src/` 源码树 + 逐文件说明）、测试与 CI（质量门禁命令 + 测试覆盖表 + CI 矩阵）从 README 外移至此；含本地测试步骤的回链。
- 两个 README 底部新增 Documentation / 文档索引章节，汇总所有 docs/ 链接及 CONTRIBUTING、CHANGELOG 入口。
- 纯文档变更，无代码或行为变化；`npm run typecheck` 通过。

**2026-08-27 · Docs · README 使用段补充 `--name` 示例与条目名回退链说明**

- README / README_CN 的「使用」代码块在 `--subdir` 示例后新增一行：`dsh-skills-nexus add github:owner/repo --subdir skills --name owner-skills`，注释写明条目名回退链（`--name` > subdir 末段 > 仓库名）。背景：集合级子目录（如 `--subdir skills`）默认条目名会取到毫无区分度的末段名 `skills`，跨仓库撞名时只能靠 `--name` 消歧，但此前使用段未展示该参数。仅文档变更，无行为变化。

**2026-08-26 · Fixed · 多 skill 条目的状态反查改为按链接目标（修复 list 误报 off / disable 空转 / 裸 update 跳过）**

- **问题**：建链接与查状态用了两把不同的钥匙——多 skill 仓库的 symlink 按每个 skill 的 frontmatter 名创建（如 `skill-01`…`skill-21`），从不以条目名命名；而 `list` / `disable` 前置判断 / 裸 `update` 目标过滤都用 `isLinked(条目名)` 按名字查，查不到就把条目误判为未启用。后果：`list` 对已启用的多 skill 条目显示 `off`；`disable` 打印 `already disabled` 静默空转（链接一个都没删）；裸 `update` 把多 skill 条目整个跳过。单 skill 仓库因条目名＝链接名而未受影响。
- **修复**：`src/link.ts` 新增 `isEntryEnabled(entry)`——扫描官方 skills 根目录，凡有 symlink 目标落在该条目克隆目录内即视为启用；与链接命名规则解耦，单/多 skill、subdir 条目均正确，且不要求克隆存在。`list` / `toggle`（前置判断）/ `update`（默认目标过滤与重建链接前的 `wasLinked` 判断）全部改用它。
- **测试**：新增 `test/toggle.test.ts` 3 条用例（多 skill 条目 disable 真删链接/enable 恢复、裸 update 包含已启用条目且跳过已禁用条目、list 显示 `on`），并登记到 `package.json` 的 test 脚本。
- **文档**：verify-collection-support 中英新增 `[g2]` 步骤（多 skill 条目开关验证）、`[g]` 期望输出补 `list` 行首为 `on`、测试表补 `test/toggle.test.ts` 行。

**2026-08-26 · Fixed · `update` 不再被脏工作区阻塞（归一化产物与 git 操作冲突）**

- **问题**：安装时归一化（`ensureDescription` / `normalizeSkillName`）会原地改写克隆内的 `SKILL.md`，导致工作区变脏。凡需要归一化的仓库（frontmatter 缺 description / 名称不合法——正是归一化存在的意义），后续 `update` 必然失败：分支 pin 的 `git pull --ff-only` 报 `Your local changes would be overwritten by merge`，tag/commit pin 的漂移恢复 `git checkout` 同样被阻断。verify-version-lock walkthrough 的 B / C 步骤实测复现。
- **修复**：`update` 在 pull / 恢复前先检测脏工作区，脏则打印 `⚠ discarding local changes in nexus-managed clone` 后丢弃（`git reset --hard` + `git clean -fd`）再继续；干净克隆行为零变化。不影响「安装时归一化」功能：`add` 流程不变，`update` 的 pull 后重新归一化照常执行（该逻辑本就是为「pull 会覆盖归一化修复」而设计），命令结束时 SKILL.md 仍为归一化终态；同时恢复了 changelog 已承诺的分支快进与漂移自愈能力。
- **新增**：`src/git.ts` 的 `isDirtyWorktree` / `discardLocalChanges`。
- **测试**：`test/git.test.ts` 新增脏检测/丢弃单测；`test/update.test.ts` 新增 2 条回归测试（脏克隆下分支快进、脏克隆下漂移恢复）。
- **文档**：verify-version-lock 中英新增 B2 步骤（脏克隆 walkthrough）、期望输出行、坑 #10（归一化弄脏克隆）与坑 #11（脏克隆也会阻塞手动 git 命令——因此把演示用初始 `SKILL.md` 改为 frontmatter 置于文件开头的合法格式，否则 C 步的手动 `git checkout FETCH_HEAD` 会被 git 拒绝）；4 份验证文档的 `ls -la ~/.dsh/skills/` 修正为 `ls -la "$DSH_HOME/skills/"`（设置演示 `DSH_HOME` 后 symlink 在 `$DSH_HOME/skills/`，`OFFICIAL_SKILLS_DIR` 跟随 `DSH_HOME`）；README / README_CN 目录树注释「untouched / 不做任何改动」改为「nexus 管理」并说明归一化与丢弃行为。两份中文验证文档全部步骤实测跑通（version-lock A/B/B2/C/D，collection [a]–[h]）。

**2026-08-26 · Fixed · 清理验证文档中已过时的硬编码测试计数**

- 4 个验证文档（`verify-version-lock.md` / `.zh-CN.md`、`verify-collection-support.md` / `.zh-CN.md`）质量门禁段仍写着硬编码用例数（version-lock 中英各写「98 个用例」、collection-support 中英各写「111 个用例」），而 2026-08-24 架构重构后实际用例数为 99，两处数值均已失效。按项目规范（验证文档不硬编码测试计数）统一改为「全部用例通过」/「expected: all tests pass」，避免每次新增测试后都要同步文档。
- 排查范围：全量复查 `test/` 9 个文件与 `docs/` 全部文档，确认无 `resolveAll` / `setEnabled` / `nexusProvider` / 旧路径 `skills-nexus/skills/` / 旧名称 `skill-bridge` 残留，DSH_HOME export/unset 12 对全部配对，测试文件导入均有使用。本次仅硬编码计数一类问题。

**2026-08-26 · Fixed · 清理 0.2.0 架构重构遗留的 5 处未使用变量 / 导入（lint 报错）**

- `npm run lint` 报 5 个 `@typescript-eslint/no-unused-vars` 错误，全部源于 2026-08-24 架构重构（Symlink + 官方 Provider）期间的重构残留，重构后未完整跑四步门禁（typecheck → lint → test → build）导致积压至今；`tsc --noEmit` 未开启 `noUnusedLocals` / `noUnusedParameters`，因此 typecheck 无法拦截，只有 lint 能发现。
- `src/cli/commands/add.ts`：删除归一化循环中未使用的 `displayName`（警告消息实际直接使用 `s.invalidName` 与 `validName`）。
- `src/cli/commands/update.ts`：删除只累加、从未读取的 `renormCount` 计数器（预期的汇总输出从未实现）。
- `src/link.ts`：删除未使用的导入 `stat`（实现全部使用 `lstat`）与 `dirname`（父目录创建简化为对 `OFFICIAL_SKILLS_DIR` 一次 `mkdir`）。
- `src/manifest.ts`：删除未使用的导入 `join`（重构后目录拼接下沉到 `paths.ts` 的 `repoDir()`）。
- 同类先例：2026-08-22 接入 CI 时曾清理过 `locator.ts` 的 `isDir`、`update.ts` 的 `findEntry` 孤儿导入——重构后应完整跑一遍门禁再提交。

**2026-08-26 · Fixed · README 本地测试 EEXIST 处理与卸载步骤修正**

- README / README_CN 的 `npm link` EEXIST 处理段落重写：新增方案 A `npm link --force`（全平台最简单）；方案 B 手动删除旧全局链接的 Git Bash 命令从硬编码 `~/AppData/Roaming/npm/...` 改为 `$(npm prefix -g)`（避免 Git Bash 中 `HOME` 环境变量配置不正确时 `~` 无法展开的问题）；新增 Windows PowerShell 段落（`Remove-Item -Force "$(npm prefix -g)\dsh-skills-nexus*"`）；移除 macOS / Linux 段落（该问题仅出现在 Windows 本地测试场景）。
- 卸载段落新增第 4 步：Windows PowerShell 删除本地测试目录 `dsh-skills-nexus` 的命令。

**2026-08-26 · Fixed · 验证文档与测试文件清理 DSH_HOME 环境变量**

- 4 个验证文档（`verify-collection-support.md` / `.zh-CN.md`、`verify-version-lock.md` / `.zh-CN.md`）的 cleanup 段只 `rm -rf` 删了临时目录但没有 `unset DSH_HOME`，跑完 walkthrough 后 `DSH_HOME` 仍指向已删除的路径，后续命令全部失效。每处 cleanup 的 `rm -rf` 后补 `unset DSH_HOME`（共 12 处：collection-support 中英各 2、version-lock 中英各 4）。
- 4 个测试文件（`add.test.ts`、`manifest.test.ts`、`update.test.ts`、`resolve.test.ts`）的 `after()` 钩子只删了临时目录但没有恢复环境变量。补 `delete process.env.DSH_HOME`。虽然 node:test 的进程隔离使跨文件不受影响，但显式清理是好习惯。

## [0.2.0] - 2026-08-24

**2026-08-26 · Fixed · Windows 下 symlink 创建报 EPERM（需要开发者模式）**

- `src/link.ts`：`linkSkill` 中 `symlink(targetDir, linkPath, 'dir')` 改为 `symlink(targetDir, linkPath, 'junction')`。Windows 上 `'dir'` 创建的是符号链接，需要开启开发者模式或管理员权限；`'junction'` 创建目录联接，不需要任何特殊权限。非 Windows 平台 Node.js 自动将 junction 回退为普通 symlink，行为不变。
- 修复了 `add` / `enable` 在 Windows 上因 `EPERM: operation not permitted` 导致 skill 无法链接到 `~/.dsh/skills/` 的问题。

**2026-08-24 · Changed · 架构重构：从「自定义 Provider」收敛为「Symlink + 官方 Provider」**

- **核心变更**：移除自定义 `nexusProvider`（`src/provider.ts` 删除），改为在 `~/.dsh/skills/` 中创建 symlink 指向 `~/.dsh/skills-nexus/repos/` 中的克隆目录。官方 filesystem provider 自动发现这些 symlink，不再需要运行时 provider 代码。
- **新增 `src/link.ts`**：symlink 管理模块（`linkSkill` / `unlinkSkill` / `isLinked` / `hasCollision`），负责在官方 skills 根目录创建/删除符号链接。
- **新增 `src/index.ts`（空实现）**：Cordis 插件入口的 `apply()` 改为空操作——仅用于 `dsh plugin add` 安装包，不再注册 provider。所有 skill 发现通过 symlink 交给官方 filesystem provider。
- **`src/paths.ts`**：新增 `OFFICIAL_SKILLS_DIR`（`~/.dsh/skills/`）和 `REPOS_DIR`（`~/.dsh/skills-nexus/repos/`），调整路径逻辑为 symlink 架构。
- **`src/frontmatter.ts`**：新增 `normalizeSkillName`（修正不合法 frontmatter name 为 kebab-case）和 `ensureDescription`（补全缺失的 description），在安装时归一化。
- **`src/git.ts`**：`sanitizeName` 修正为仅允许 `[a-z0-9]` 和 `-`（移除 `.` 和 `_` 保留），对齐官方 `SKILL_NAME` 规则。
- **`src/resolve.ts`**：`isValidSkillName` 正则修正为 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（严格 kebab-case）；`resolveAll` / `resolveByName` 删除，保留 `previewSkills` 和 `isValidSkillName`。
- **`src/types.ts`**：删除 DSH SDK 相关类型（`SkillCandidate` / `SkillDefinition` / `SkillProvider` / `NexusContext`），保留 `SkillEntry` 和 `Manifest`。
- **`src/manifest.ts`**：删除 `setEnabled` 函数（enable/disable 改为 symlink 方式，不再操作 manifest 字段）。
- **CLI 命令更新**：
  - `add`：新增 frontmatter 归一化步骤 + symlink 创建逻辑；保留 wrapped-skill y/n 确认提示。
  - `enable` / `disable`（`toggle.ts`）：重写为 symlink 创建/删除逻辑。
  - `list`：从 symlink 状态推断 enabled/disabled。
  - `update`：新增 pull 后重新归一化 + 重新创建 symlink 逻辑。
  - `remove`：处理 symlink 删除。
- **`package.json`**：版本升至 0.2.0；保留 `dsh.bundle.patch`（指向 `cordis.patch.yml`）和 `bin` 字段；移除 peerDependencies。
- **`cordis.patch.yml`**：保留，用于 `dsh plugin add` 安装。
- **README / README_CN**：更新架构图、文件系统布局（解释 `repos/` 和 symlink 两层目录）、工作原理、项目结构、本地测试步骤（保留五步流程）、卸载步骤（保留 `dsh plugin remove`）；顶部底部添加 Star 按钮和中英文切换。
- **docs/**：6 个文档文件更新，将 `resolveAll()` Node 脚本替换为 `dsh-skills-nexus list` + `ls -la ~/.dsh/skills/`；更新 provider 相关描述；修正 4 个文档文件中残留的旧路径 `skills-nexus/skills/` → `skills-nexus/repos/`（`nexus-vs-plugin.md` / `.zh-CN.md` 各 1 处，`verify-version-lock.md` / `.zh-CN.md` 各 2 处）。
- **测试**：更新 `test/git.test.ts`（`sanitizeName` 新行为）、`test/manifest.test.ts`（删除 `setEnabled` 测试）、`test/resolve.test.ts`（删除 `resolveAll` / `resolveByName` 测试，更新 `isValidSkillName` 断言）；99 个用例全部通过；`lib/` 重新编译。

**2026-08-23 · Fixed · 非法 frontmatter name 回退条目名（防止 DSH 拒绝整个 provider）**

- 实测 `CodeManYsf/cyysf-trae-skills` 的 `CurriculumDesigner` skill：frontmatter `name` 为大驼峰，DSH 报 `provider "dsh-skills-nexus" returned invalid skill name`，且**整个 provider 的所有 skill 都不可见**（移除后才恢复）。
- `resolve.ts` 新增 `isValidSkillName`（小写 kebab-case：`^[a-z0-9][a-z0-9._-]*$`）：frontmatter `name` 非法时回退条目名（与无 name 同一套回退），并记录 `invalidName` 供 `add` 警告——provider 不再返回 DSH 无法接受的名字。
- `add` 解析预览时对非法名打印 `⚠` 警告（告知实际注册名）。
- 测试 +2（`isValidSkillName` 边界、非法名回退与 `invalidName` 标记），113 个用例全部通过；`lib/` 重新编译。

**2026-08-23 · Added · 集合仓库验证文档（中英）与 README 入口**

- 新增 `docs/verify-collection-support.md` 与 `docs/verify-collection-support.zh-CN.md`：集合仓库支持（P1）的端到端验证流程，Windows（Git Bash）/ Linux / macOS 各一份可整体复制的命令块，覆盖质量门禁（111 用例）、全量拒绝 + `--subdir` 提示、按子目录独立克隆安装、SUBDIR 列、按条目 enable/disable、remove 隔离、大集合防呆、平铺 md 身份规则（无 frontmatter 平铺 md ≠ skill），并收录踩过的坑（DSH_HOME 累积、交互确认、subdir 校验、平台路径、git 版本）与覆盖边界。
- README / README_CN「开发：测试与 CI」入口链接改为双文档（版本锁定 P0 + 集合仓库 P1）。

**2026-08-23 · Added · 集合仓库支持（--subdir）与平铺扫描保守化**

- **平铺扫描保守化（修"假装安装"）**：locator 跳过名单改为前缀模式（`readme*` / `contributing*` / `changelog*` / `license*` / `code-of-conduct*` / `code_of_conduct*` / `security*`），`README.zh-CN.md` 等变体不再被当作 skill 候选；平铺 `*.md` 没有 frontmatter `name` 且没有 `description` 的不再成为 skill（resolve 阶段过滤）——集合仓库根目录的文档文件（`community-leaderboard.md` 等）永远不会被"假装安装"。
- **add 解析预览**：注册前按完整 skill 规则解析预览，结果为 0 时拒绝安装并提示嵌套子目录可用 `--subdir`；unknown 分支同样检测嵌套并提示（修掉 Observed 记录中的空条目隐患）。
- **新增 `--subdir <path>`**：只把克隆内某个子目录当作 skill 根安装（**独立克隆设计，v1**；P1/P2 命令对比与隐藏坑见 [docs/subdir-design.md](docs/subdir-design.md)）。条目新增 `subdir` 字段（向后兼容），name 默认取子目录末段（`--name` 可覆盖），path 按 `repo-subdir` 唯一化；resolve 按 `subdir` 拼接解析根；`list` 新增 SUBDIR 列。
- **大集合防呆**：一次安装解析出超过 20 个 skill 时弹确认提示（`--yes` 跳过，非 TTY 默认拒绝）；显式 `--subdir` 安装跳过该提示。
- **测试**：新增集合仓库用例（`--subdir` 安装 / 缺失路径 / 非法值 / 嵌套拒绝 / 大集合确认）、locator 文档变体、resolve 平铺过滤与 subdir 拼接、repo-kind `markerDir` 用例——111 个用例全部通过。
- 同步更新 README / README_CN、verify-version-lock 中英（新增「集合仓库」验证节）、CHANGELOG 与编译产物 `lib/`。

**2026-08-23 · Observed · 嵌套集合仓库会被"假装安装"（集合仓库支持功能的动机）**

- 现象：对 `skills/<name>/SKILL.md` 布局的**集合仓库**（实测 `trae-community/trae-skills`，12 个 skill）执行 `add` 会注册"成功"（exit 0），但实际装入的是仓库根目录的文档型 md：`README.zh-CN.md`、`CONTRIBUTING.md`、`CONTRIBUTING.zh-CN.md`、`community-leaderboard.md`——全部因无 frontmatter 而回退为 entry 名；`skills/` 下的 12 个真 skill 一个都没有被发现。比直接拒绝更隐蔽：用户会误以为装好了。
- 根因：`locator.ts` 的单层子目录规则（`<root>/<name>/SKILL.md`）够不到 `skills/` 前缀的两层嵌套；平铺规则（规则 3）把根目录所有非精确 `readme.md` / `changelog.md` / `license.md` 的 `.md` 文件都当作 skill 候选，跳过名单不做模式匹配（`README.zh-CN.md` 等变体漏网）。
- 复现命令（2026-08-23 实测）：
  ```bash
  git clone --depth 1 https://github.com/trae-community/trae-skills /tmp/trae-skills
  ls /tmp/trae-skills | head -30                       # 根含 skills/ 分类目录
  find /tmp/trae-skills -maxdepth 2 -name SKILL.md | wc -l   # → 0
  find /tmp/trae-skills -maxdepth 3 -name SKILL.md | wc -l   # → 12（两层嵌套）
  export DSH_HOME="$(cygpath -m "$TEMP/nexus-trae-demo")"
  node lib/cli/index.js add "C:/Users/asswsw/AppData/Local/Temp/trae-skills"  # → exit 0
  node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"
  # → 仅 4 个文档文件被解析为 skill（name 全部回退 trae-skills）
  ```
- 结论：集合仓库当前不可用且不可控。作为「集合仓库支持」功能（`--subdir` 子路径选择 + 平铺扫描保守化）的动机记录，列入下一迭代计划（P1）。

**2026-08-23 · Added · 版本锁定验证文档（中英）与 README 入口**

- 新增 `docs/verify-version-lock.md` 与 `docs/verify-version-lock.zh-CN.md`：版本锁定（P0）的端到端验证流程，Windows（Git Bash）/ Linux / macOS 各一份可直接复制的命令块，覆盖测试套件、分支快进、tag 固定点、漂移自愈、重复 add 保护与 manifest 锁检查，并收录实践中踩过的坑（浅克隆 checkout、注册名来源、残留 DSH_HOME、路径格式、git 版本等）与覆盖边界。
- README / README_CN「开发：测试与 CI」小节加入口链接。

**2026-08-23 · Added · 版本锁定（lockfile-lite）与 pinned 更新的语义修正**

- `SkillEntry` 新增 `commit` 字段：`add` 克隆成功后记录实际解析到的 commit SHA（`git rev-parse HEAD`），manifest 成为轻量锁文件；`list` 新增 COMMIT 列显示安装版本的短 SHA。
- `update` 按 pin 类型分派：分支 pin → `git pull --ff-only`，打印 commit 变化（`A → B`）并重新盖章 `commit`；tag / commit pin（detached HEAD）→ 不再执行 pull（修复此前 `git pull` 在 detached HEAD 上必然失败的问题），改为校验本地 HEAD 是否仍等于 pin 的 commit，漂移时自动恢复。
- 旧 manifest 无需迁移：缺失 `commit` 时 `list` 显示 `—`，首次成功 `update` 后自动补齐。
- 新增测试：`git.test.ts` 增加本地仓库用例（`getHeadCommit` / `isDetachedHead` / `resolveRefCommit` / `checkoutRef`、clone 分支 vs tag 的 HEAD 形态）；新增 `test/update.test.ts` 用本地 `file://` 远端覆盖「分支快进」「tag 固定点」「漂移恢复」三条路径；`manifest.test.ts` 覆盖 `markUpdated` 盖章 commit。
- 修复 `add` 对已注册仓库重复添加时的破坏性清理：重复注册检查提前到 clone 之前（此前 clone 因目录已存在而失败时，失败清理会误删已注册 skill 的克隆目录）。新增 `test/add.test.ts` 覆盖「注册记录 commit」与「重复添加拒绝且克隆完好」。
- 同步更新 README / README_CN（Usage 注释与注意事项）与编译产物 `lib/`。

**2026-08-23 · Changed · docs：Quick flow 流程图改为 Mermaid**

- 将 `docs/nexus-vs-plugin.md` 与 `docs/nexus-vs-plugin.zh-CN.md` 中 Quick flow / 快速流程图 的 ASCII 树形图替换为 `flowchart LR` 的 Mermaid 图，横向展开避免纵向过长。
- 配色与 README 架构图一致（`classDef` 统一声明：灰=起点、琥珀=判断、绿=分类、蓝=命令、粉=终止），中英文两版保持同一结构。

**2026-08-22 · Added · 接入 CI、单元测试与 lint，补齐 nexus vs plugin 决策文档**

- 新增 GitHub Actions CI（`.github/workflows/ci.yml`）：push / PR 时在 Node 18/20/22 上依次跑 `typecheck` → `lint` → `test` → `build`，并校验已提交的 `lib/` 与最新源码一致（防止发布包与源码漂移）。
- 新增 ESLint 9 + typescript-eslint（flat config，`eslint.config.js`），`npm run lint` / `npm run lint:fix`；顺手删除了 `locator.ts` 中未使用的 `isDir`、`update.ts` 中未使用的 `findEntry` 导入。
- 新增单元测试（`node:test` + tsx，无额外测试框架），共 86 个用例，覆盖：`git.ts`（parseGitSpec 全部仓库格式 / repoSlug / sanitizeName）、`frontmatter.ts`（坏 YAML、块标量、CRLF、flag）、`locator.ts`（三种发现布局、跳过文件、隐藏目录）、`repo-kind.ts`（四种仓库分类）、`cli/args.ts`、`manifest.ts`（临时 DSH_HOME 读写往返、损坏文件备份）、`resolve.ts`（多 skill、开关、名称回退）。
- 新增 `tsconfig.test.json` + `npm run test:build`：把 src + test 编译到 `test-dist/`，可在无 tsx loader 的环境直接 `node --test` 运行。
- 新增 `docs/nexus-vs-plugin.md` 与 `docs/nexus-vs-plugin.zh-CN.md`：用仓库内容分类讲清「什么情况用 nexus、什么情况用 dsh plugin」，含决策表、流程图、示例与 FAQ；README / README_CN 顶部加入口链接与 CI 徽章。

**2026-08-22 · Added · add 命令增加仓库类型识别与确认提示**

- 新增 `src/repo-kind.ts`，在 `add` 注册前对克隆仓库进行分类：纯 SKILL.md 仓库、SKILL.md + DSH 薄包装层、纯 DSH 插件、无法识别仓库。
- 对「SKILL.md + DSH 薄包装层」仓库，`add` 会询问是否忽略包装层并按 nexus 管理；输入 `y` 继续，输入 `n` 中止并提示改用 `dsh plugin add`。
- 对「纯 DSH 插件」仓库，直接提示请按该仓库自己的 DSH 插件安装方式使用，不注册并退出。
- 对「两者都不是」的仓库，报错退出。
- 新增 `--yes` / `-y` / `--force` 参数，可跳过薄包装层确认提示；非交互环境下默认不继续，避免自动化挂起。
- 同步更新 README 与编译产物 `lib/`。

**2026-08-22 · Changed · 项目改名 dsh-skill-bridge → dsh-skills-nexus**

- GitHub 上已有同名项目 `dsh-skills-hub`（by lcthe），且 `dsh-skills-bridge` 也已有类似项目，为避免混淆改名。
- `nexus` = 枢纽/连接中心，贴合项目定位：一个 provider 承载多个 skill，是所有外部 skill 进入 DSH 的中心节点。
- 全局替换：包名、CLI 命令名、插件 ID、provider 变量名（`bridgeProvider` → `nexusProvider`）、上下文类型（`BridgeContext` → `NexusContext`）、本地存储目录（`~/.dsh/skill-bridge/` → `~/.dsh/skills-nexus/`）、环境变量（`DSH_SKILL_BRIDGE_HOME` → `DSH_SKILLS_NEXUS_HOME`）。
- 项目文件夹同步从 `dsh-skill-bridge/` 重命名为 `dsh-skills-nexus/`。

**2026-08-22 · Fixed · 修正本地测试第五步说明**

- 原文仅写「回到 DSH 会话问一句」，未说明第三步启动的 DSH 进程在第四步加 skill 之前就已运行，直接在原界面提问看不到新 skill。
- 补充明确说明：必须回到第三步的终端，`Ctrl+C` 停掉 DSH 进程，重新执行 `npx @deepseek-ai/dsh web --patch overlay.yml`，让 provider 重新加载后 `list()` 才会扫描到新 skill。

**2026-08-22 · Fixed · 修正 overlay.yml 中 Windows 路径格式说明**

- Node.js ESM loader 在 Windows 上将裸 `C:/...` 路径中的 `C:` 解释为 URL 协议，导致 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 错误。
- 修正两个 README 中的 overlay.yml 路径说明：Windows **必须**在盘符前加 `/`（即 `/C:/...`），对应的一键生成命令从 `'$(pwd -W)/lib/index.js'` 改为 `'/$(pwd -W)/lib/index.js'`。
- YAML 注释中 macOS / Linux 路径示例拆分为独立两行（`# macOS:` / `# Linux:`），不再合并写为 `# macOS / Linux:`。

**2026-08-22 · Changed · README 结构重构**

- 删除独立的「构建」章节：终端用户通过 `dsh plugin add` 安装时直接使用仓库内已提交的 `lib/`，无需手动 build。
- `npm run typecheck` 从独立章节移至「本地测试步骤」第一步内，作为可选提示。
- 「工作原理」从「使用」和「文件系统布局」之间移至「发布」之后、「注意事项」之前，与「项目结构」相邻——开发者视角的内容靠后，用户流程优先。
- 安装章节补充说明：「`lib/` 编译产物已随仓库提交，安装即用」。
- GitHub 用户名占位符 `<你>` / `<you>` 全部替换为 `xiaxi626`。

**2026-08-22 · Added · 新增 CHANGELOG**

- 新增 `CHANGELOG.md`，遵循 Keep a Changelog 1.1.0 + SemVer 规范，中文编写。
- 记录 0.1.0 版本的全部新增与修复内容。

**2026-08-22 · Added · package.json 新增 repository / homepage / bugs 字段**

- 指向 `https://github.com/xiaxi626/dsh-skills-nexus`。
- 不使用 `prepare` 脚本——编译产物 `lib/` 直接随仓库提交，安装即用，不依赖用户环境的 TypeScript 工具链，也避免 npm / pnpm 行为差异。

**2026-08-22 · Added · 新增 README_CN.md**

- 完整中文版 README，与英文版内容同步。

## [0.1.0] - 2026-08-22

**2026-08-22 · Fixed · clone 失败时自动清理半成品目录**

- 此前 `git clone` 失败会留下空目录或不完整目录，导致重试时可能被目录存在干扰。
- 改为 `try/catch` 包裹 clone 操作，失败时 `rm -rf` 清理目标目录，保证重试干净。

**2026-08-22 · Fixed · 默认分支从硬编码 main 改为自动探测**

- `add` 命令未指定 `#ref` 时，通过 `git ls-remote --symref` 查询远程 HEAD 符号引用，自动识别 `master` / `main` 等默认分支名。
- 修复了默认分支不是 `main` 的仓库（如 `xiaxi626/theme-port-skill`）clone 失败的问题。
- 用户仍可通过 `#branch` / `#tag` / `#commit-sha` 显式指定引用。

**2026-08-22 · Added · 项目配置与文档**

- 新增 `package.json`：声明 `dsh.bundle.patch`，指向 `cordis.patch.yml`，可被 `dsh plugin add` 作为插件安装。
- 新增 `cordis.patch.yml`：Cordis bundle patch layer 注册文件。
- 新增 `tsconfig.json`：TypeScript 编译配置（NodeNext 模块、严格模式、输出到 `lib/`）。
- 新增 `.gitignore`：排除 `node_modules/`、`lib/`、`overlay.yml`、`test-provider.mjs` 等本地开发文件。
- 新增 `README.md`：包含安装、使用、工作原理、SKILL.md 发现规则、文件系统布局、项目结构、构建、卸载、本地测试步骤、更轻的验证方式、发布方式、注意事项。
- 本地测试文档覆盖五步流程（编译 → overlay → 启动 DSH → CLI 加 skill → DSH 内验证），并提示移动项目文件夹会导致 `npm link` 报 EEXIST 及处理方法。

**2026-08-22 · Added · CLI 命令（add / list / update / remove / enable / disable）**

- 新增 `src/cli/index.ts`：命令分发器，支持 `add` / `list` / `update` / `remove` / `enable` / `disable` 六个子命令（含别名 `ls` / `rm` / `pull`）。
- 新增 `src/cli/args.ts`：轻量 argv 解析，支持 `--name` / `--ref` 选项。
- 新增 `dsh-skills-nexus add`：克隆 GitHub 仓库到 `~/.dsh/skills-nexus/skills/<name>/` 并写入 manifest；自动探测默认分支；clone 失败时清理半成品目录。
- 新增 `dsh-skills-nexus list`：列出所有已注册 skill 及其状态（启用/禁用、ref、目录是否存在、更新时间）。
- 新增 `dsh-skills-nexus update`：对指定或全部已启用 skill 执行 `git pull --ff-only`，成功后更新 `updatedAt`。
- 新增 `dsh-skills-nexus remove`：删除 clone 目录并从 manifest 注销。
- 新增 `dsh-skills-nexus enable / disable`：切换 skill 的目录可见性，不删除文件。
- `package.json` 声明 `bin` 字段，`npm link` 后可全局使用 `dsh-skills-nexus` 命令。

**2026-08-22 · Added · 项目初始化：DSH 通用 skill 枢纽插件**

- 新增 `src/index.ts`：Cordis 插件入口，通过 `ctx.skills.registerProvider()` 注册 `nexusProvider`，采用薄包装层模式。
- 新增 `src/provider.ts`：`nexusProvider` 实现 `list()` / `get()` 两个方法，单个 provider 承载多个 skill；`resourceBase` 按 skill 指向各自的 clone 目录，使 `references/`、`scripts/`、`assets/` 相对路径可被模型正确解析。
- 新增 `src/resolve.ts`：读取 manifest → 定位 SKILL.md → 解析 frontmatter → 组装 `SkillCandidate` / `SkillDefinition`。
- 新增 `src/manifest.ts`：manifest.json 的读写、查找、增删、启用/禁用，作为 CLI 与 provider 之间的状态后端。
- 新增 `src/locator.ts`：在克隆仓库内按优先级发现 SKILL.md（根目录 `SKILL.md` → `<name>/SKILL.md` 子目录 bundle → 扁平 `<name>.md`），与官方 `dsh-skill-filesystem` 发现规则对齐。
- 新增 `src/frontmatter.ts`：基于 `yaml` 包的 frontmatter 解析，支持 block scalar（`>` / `|`），识别 `name`、`description`、`disable-model-invocation`、`user-invocable` 字段。
- 新增 `src/git.ts`：`parseGitSpec()` 支持 `github:`、`https://`、`git+https://`、`git@`、`owner/repo` 简写等多种输入形式；`cloneRepo()` 浅克隆，支持分支/tag/commit SHA；`getDefaultBranch()` 通过 `git ls-remote --symref` 自动探测远程默认分支（回落到 `main`）。
- 新增 `src/paths.ts`：`DSH_HOME` / `DSH_SKILLS_NEXUS_HOME` / `SKILLS_DIR` / `MANIFEST_PATH` 路径常量，支持环境变量覆盖。
- 新增 `src/types.ts`：`Manifest` / `SkillEntry` / `SkillCandidate` / `SkillDefinition` / `SkillProvider` / `NexusContext` 结构类型，项目在没有 `@deepseek-ai/dsh-skill` 时也能通过类型检查。
