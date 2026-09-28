# 贡献指南

[English](CONTRIBUTING.md) | **中文**

感谢你有兴趣贡献！本指南涵盖源码结构、本地开发和质量门禁。

本地测试运行中的工具（编译 → overlay → DSH → 验证），请看 README 的
**[本地测试步骤](README_CN.md#本地测试步骤)**——那是面向用户的端到端流程。

## 项目结构

```
src/
├── index.ts          # Cordis 插件入口——在 web 宿主中惰性注册 /skills-nexus/* 路由
├── cli/
│   ├── index.ts      # 命令分发
│   ├── args.ts       # 轻量 argv 解析
│   ├── glob.ts       # remove 的 * / ? 通配展开
│   ├── progress.ts   # TTY 门控 spinner（add / update）
│   ├── prompt.ts     # 交互式确认
│   └── commands/     # add · list · update · switch-version · remove · toggle · doctor · completions
├── client/           # 浏览器半边——不参与服务端构建，由 build:client 打包
│   ├── index.tsx     # 模块形态：name / inject / apply（Settings 槽位）
│   ├── api.ts        # 类型化 HTTP 客户端 + confirmable / pollJob / reconcileList
│   └── panel.tsx     # Skills Nexus 设置面板
├── http/             # /skills-nexus/* 路由：types / util（信封 + 校验）/ jobs / io / routes
├── ops-io.ts         # OpsIO 接缝：emit / progress / interactive / confirm + NeedsConfirm
├── locks.ts          # 三层并发：进程内 single-flight、缓存锁、O_EXCL 文件锁
├── switch-version.ts # 切换编排（fetch → checkout → 重归一化 → 重建链接）
├── zip.ts            # 极简 PKZip 解析器 + installFromZip（加固版）
├── health.ts         # checkUpdates 抽取（六态）+ doctor 检查
├── update-cache.ts   # 进程内更新缓存（从不落盘）
├── link.ts           # symlink 管理（link/unlink/碰撞/按目标归属扫描）
├── resolve.ts        # 解析克隆仓库为发现的 skill（previewSkills + isValidSkillName）
├── manifest.ts       # manifest.json 读/写/查找/增/删 + listEntries
├── locator.ts        # 在克隆内定位 SKILL.md（3 种发现布局）
├── frontmatter.ts    # 基于 yaml 的 frontmatter 解析器 + 归一化
├── git.ts            # parseGitSpec / cloneRepo / pullRepo / fetch（execFile，无 shell）
├── paths.ts          # 官方 skills 根 / repos / manifest / locks 路径常量
├── types.ts          # Manifest / SkillEntry 类型
└── repo-kind.ts      # 克隆仓库分类（纯内容 / 包装 / 插件 / 无法识别）
```

运行时依赖只有 `yaml`。在 **web** 宿主中，`index.ts` 惰性注入 web server 并注册
`/skills-nexus/*` 路由（外加经浏览器半边挂上的设置面板）；非 web 宿主里插件层保持
沉默。skill 发现本身从不依赖插件层——一律经由指向官方 filesystem provider 的
symlink。

完整架构（数据流、目录布局、SKILL.md 发现规则），见
**[docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)**。

## 开发：测试与 CI

> **想端到端验证某个功能？**
> - [验证版本锁定功能（P0）](docs/verify-version-lock.zh-CN.md) ——
>   测试套件、分支快进、tag 固定点、漂移恢复、重复 add 保护。
> - [验证克隆重试功能（P0）](docs/verify-clone-retry.zh-CN.md) ——
>   测试套件、指数退避观测、分支/标签/commit-SHA 克隆回归。
> - [验证集合仓库支持（P1）](docs/verify-collection-support.zh-CN.md) ——
>   `--subdir` 按需安装、平铺 md 过滤、大集合防呆。
> - [验证 `doctor` 命令（P0）](docs/verify-doctor.zh-CN.md) ——
>   只读体检：报告状态/code、退出码、`--json` / `--updates` / `--quiet`、孤立对象与损坏 manifest 的处理。
> - [验证命令补全（P1–P2）](docs/verify-completions.zh-CN.md) ——
>   bash / zsh / fish / PowerShell 四套模板：各 shell 驱动方式、分层场景、引擎特性。
> 每篇均为覆盖 Windows / Linux / macOS 的可直接复制的验证流程。

质量门禁，本地全部可跑：

```bash
npm run typecheck     # tsc --noEmit（strict）
npm run lint          # ESLint 9 + typescript-eslint（flat config）
npm test              # 单元测试——node:test + tsx，不引入额外测试框架
npm run build         # tsc → lib/
npm run test:build    # tsc -p tsconfig.test.json → test-dist/（对 test/ 做类型检查）
npm run build:client  # tsdown + tsc → lib/client.js + lib/client-types/（浏览器半边）
```

`npm run build:client` 打包浏览器半边（`src/client/`）并单独产出其类型。它刻意**不**
并入 `npm run build` 或 CI：tsdown 的引擎门槛（Node ^22.18 || >=24.11）超出了支持
矩阵里的 Node 20 入口，因此客户端 bundle 在足够新的 Node 上本地构建后，与其余
`lib/` 一样随仓库提交。

测试位于 `test/`，覆盖纯逻辑模块：

| 模块 | 测试文件 | 验证内容 |
|---|---|---|
| `src/git.ts` | `test/git.test.ts` | `parseGitSpec`（所有接受的仓库格式）、`repoSlug`、`sanitizeName`、`retry`（指数退避）、`cloneRepo`（分支/标签/commit-SHA） |
| `src/frontmatter.ts` | `test/frontmatter.test.ts` | frontmatter 与正文切分、坏 YAML、块标量、CRLF、`flag()` |
| `src/locator.ts` | `test/locator.test.ts` | 三种 SKILL.md 发现布局、跳过文件、隐藏目录 |
| `src/repo-kind.ts` | `test/repo-kind.test.ts` | 仓库分类：纯内容 / 包装 / 插件 / 无法识别 |
| `src/cli/args.ts` | `test/args.test.ts` | 极简 argv 解析器 |
| `src/manifest.ts` | `test/manifest.test.ts` | 在临时 `DSH_HOME` 上做 manifest 读写往返 |
| `src/resolve.ts` | `test/resolve.test.ts` | `previewSkills`（预览 skill）、`isValidSkillName` 校验 |
| `src/link.ts` | `test/link.test.ts` | 在临时 `DSH_HOME` 上跑 `linkSkill` / `isEntryEnabled` / `unlinkSkill` / `hasCollision`——真实覆盖 Windows junction 与 macOS/Linux symlink 两条代码路径 |
| `src/ops-io.ts` | `test/ops-io.test.ts` | 经 OpsIO 接缝的字节级 stdout 捕获、双向 TTY 门控、`NeedsConfirm` |
| `src/zip.ts` | `test/zip.test.ts` | 手工构造的 zip fixture：安装 / 归一化 / 多 skill，及完整拒绝矩阵（zip-slip、体积炸弹、zip64、加密……） |
| `src/switch-version.ts` | `test/switch-version.test.ts` | 分支↔tag↔sha 端到端、缺 ref 零改动、脏克隆丢弃、链接重建、CLI 包装 |
| `src/locks.ts` | `test/locks.test.ts` | O_EXCL 写入/释放、活锁拒绝、stale-PID / 超时 / 损坏文件恢复、进程内 single-flight |
| `src/http/`（routes） | `test/api.test.ts` | 基于 fake req/res 的 12 条路由全表——信封方言、409 confirm-required、toggle 目标归属、add-zip job 流水线、hotReload 状态 |
| `src/client/api.ts` | `test/client-api.test.ts` | 基于录制式 fake fetch 的类型化客户端——信封、confirmable 重试、`pollJob`、`reconcileList` |

`npm run test:build` 把 `src/` + `test/` 编译到 `test-dist/`，可无 loader 直接跑
（`node --test test-dist/test/`），适合 tsx loader 不可用的环境。

CI（`.github/workflows/ci.yml`）在 push/PR 时于 `ubuntu` / `windows` / `macos` × Node
20/22/24 的矩阵上运行。typecheck、lint、单元测试、build 在三个 OS 上都跑，因此
Windows junction（`src/link.ts` 里的 `symlink(..., 'junction')`）与 macOS/Linux symlink
两条路径都会被真实执行。唯独「已提交的 `lib/` 是否与最新构建一致」的校验固定在
`ubuntu-latest`：`tsc` 产物是确定性的、与 OS 无关，把该步限定在 Linux 可避免 Windows
CRLF / `core.autocrlf` 导致 `git diff` 误报。由于本仓库是公开的，额外的 OS runner
不产生费用——唯一代价是排队时间变长。

### 推送前用 actionlint 本地校验 workflow（可选）

`actionlint` 会静态检查 `.github/workflows/*.yml`——矩阵/表达式语法、`runs-on`、
`if`、`shell`、action 版本等——让你在浪费一次推送之前就发现 workflow 写错了。
它**故意不接进 CI**：GitHub 在解析阶段本就会拒绝非法 workflow，再在 CI 里跑一遍
actionlint 属于冗余。只把它当作推送前的本地检查。

安装（需要 Go 工具链；二进制会落到 `$(go env GOPATH)/bin`，Windows 上即
`C:\Users\<你>\go\bin\actionlint.exe`——请确保该目录在 `PATH` 里）：

```bash
go install github.com/rhysd/actionlint/cmd/actionlint@latest
```

在仓库根目录运行（退出码 `0` 且无输出即通过）：

```bash
actionlint                              # 扫描 .github/workflows/ 下全部文件
actionlint .github/workflows/ci.yml     # 或只查你改动的那一个
```

> actionlint 可选地调用 `shellcheck`（校验 bash `run:` 脚本体）与 `pyflakes`
> （校验 python `run:` 脚本体）。若未安装，它会打印一条“rule disabled”提示并
> 跳过——核心的 workflow 检查仍会正常执行。我们唯一的 bash 步骤只是个简单的
> `git diff`，因此装不装 shellcheck 都可以。

## 提交与 PR 约定

- **Conventional Commits**——每个提交都带类型前缀（和可选 scope）：
  `feat(scope):`、`fix(scope):`、`docs:`、`ci:`、`build:`、`refactor:`、`test:`、`chore:`。
- **功能改动与纯文档分开**——功能性改动（`src/`、`test/` 及重新构建的 `lib/`）与纯文档改动
  （README / CONTRIBUTING / `docs/`）拆成**独立提交**。`feat`/`fix` 提交只带代码、测试、
  重新构建的 `lib/` 与 CHANGELOG 记录；紧随其后的 `docs:` 提交只带文档文件。
- **提交前先更新 `CHANGELOG.md`**，与它描述的改动放在同一个提交里，记在 `## [Unreleased]` 下，
  遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
- **开 PR 时**——[PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 会用一份对齐上述 CI 门禁的质量
  checklist 预填描述；照着填，并把任何平台相关行为写给审阅者。
