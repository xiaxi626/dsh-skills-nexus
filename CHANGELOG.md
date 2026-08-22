# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
