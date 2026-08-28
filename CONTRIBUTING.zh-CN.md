# 贡献指南

[English](CONTRIBUTING.md) | **中文**

感谢你有兴趣贡献！本指南涵盖源码结构、本地开发和质量门禁。

本地测试运行中的工具（编译 → overlay → DSH → 验证），请看 README 的
**[本地测试步骤](README_CN.md#本地测试步骤)**——那是面向用户的端到端流程。

## 项目结构

```
src/
├── index.ts          # Cordis 插件入口（apply 空实现，仅用于 dsh plugin add 安装）
├── link.ts           # symlink 管理（link/unlink/碰撞检测）
├── resolve.ts        # 解析克隆仓库中的 skill（previewSkills + isValidSkillName）
├── manifest.ts       # manifest.json 的读写/查找/增删
├── locator.ts        # 在克隆目录中定位 SKILL.md（3 种发现布局）
├── frontmatter.ts    # 基于 yaml 的 frontmatter 解析 + 归一化（normalizeSkillName / ensureDescription）
├── git.ts            # parseGitSpec / cloneRepo / pullRepo（execFile，无 shell）
├── paths.ts          # 官方 skills 根 / repos / manifest 路径常量
├── types.ts          # Manifest / SkillEntry 类型
├── repo-kind.ts      # 克隆仓库分类（纯内容 / 包装 / 插件 / 无法识别）
└── cli/
    ├── index.ts      # 命令分发
    ├── args.ts       # 轻量 argv 解析
    └── commands/     # add · list · update · remove · toggle
```

运行时依赖只有 `yaml`。`index.ts` 的 `apply()` 是空实现——不再注册自定义 provider，所有 skill 发现通过 symlink 交给官方 filesystem provider。

完整架构（数据流、目录布局、SKILL.md 发现规则），见
**[docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)**。

## 开发：测试与 CI

> **想端到端验证某个功能？**
> - [验证版本锁定功能（P0）](docs/verify-version-lock.zh-CN.md) ——
>   测试套件、分支快进、tag 固定点、漂移恢复、重复 add 保护。
> - [验证集合仓库支持（P1）](docs/verify-collection-support.zh-CN.md) ——
>   `--subdir` 按需安装、平铺 md 过滤、大集合防呆。
> 两者均为覆盖 Windows / Linux / macOS 的可直接复制的验证流程。

质量门禁，本地全部可跑：

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint（flat config）
npm test            # 单元测试——node:test + tsx，不引入额外测试框架
npm run build       # tsc → lib/
```

测试位于 `test/`，覆盖纯逻辑模块：

| 模块 | 测试文件 | 验证内容 |
|---|---|---|
| `src/git.ts` | `test/git.test.ts` | `parseGitSpec`（所有接受的仓库格式）、`repoSlug`、`sanitizeName` |
| `src/frontmatter.ts` | `test/frontmatter.test.ts` | frontmatter 与正文切分、坏 YAML、块标量、CRLF、`flag()` |
| `src/locator.ts` | `test/locator.test.ts` | 三种 SKILL.md 发现布局、跳过文件、隐藏目录 |
| `src/repo-kind.ts` | `test/repo-kind.test.ts` | 仓库分类：纯内容 / 包装 / 插件 / 无法识别 |
| `src/cli/args.ts` | `test/args.test.ts` | 极简 argv 解析器 |
| `src/manifest.ts` | `test/manifest.test.ts` | 在临时 `DSH_HOME` 上做 manifest 读写往返 |
| `src/resolve.ts` | `test/resolve.test.ts` | `previewSkills`（预览 skill）、`isValidSkillName` 校验 |

`npm run test:build` 把 `src/` + `test/` 编译到 `test-dist/`，可无 loader 直接跑
（`node --test test-dist/test/`），适合 tsx loader 不可用的环境。

CI（`.github/workflows/ci.yml`）在 push/PR 时于 Node 20/22/24 上运行：
typecheck、lint、单元测试、build，以及「已提交的 `lib/` 是否与最新源码一致」的校验。
