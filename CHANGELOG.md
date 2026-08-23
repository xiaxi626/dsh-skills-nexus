# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
