# dsh-skills-nexus

<p align="center">
  <img src="docs/assets/banner.svg" alt="dsh-skills-nexus — 每个 skill，一个地方，每台机器" width="1200"/>
</p>

<p align="center">
  <img src="https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml/badge.svg" alt="CI"/>
  <img src="https://img.shields.io/npm/v/dsh-skills-nexus" alt="NPM 版本"/>
  <img src="https://img.shields.io/npm/dt/dsh-skills-nexus" alt="NPM 下载量"/>
  <img src="https://www.dsh.so/badge/dsh-skills-nexus.svg" alt="dsh.so 风险"/>
  <img src="https://dsh-plugin.org/badges/listed.svg" alt="已收录至 dsh-plugin.org"/>
  <img src="https://img.shields.io/github/license/xiaxi626/dsh-skills-nexus" alt="许可证"/>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>中文</strong>
</p>

**DeepSeek Harness (DSH) 的 skill 全生命周期管理器。** 注册任意 git 上的 `SKILL.md` 仓库、链接 Trae / Qoder / CodeBuddy 里已装的技能、打包跨机器搬运，或通过 DSH Web 面板可视化操作——一条 CLI 全搞定。

dsh-skills-nexus 是**社区维护**的 DeepSeek Harness 插件，非 DeepSeek 官方产品。

## 3 分钟快速上手

拿一个 skill 仓库，三步装进 DSH：

```bash
# 1. 安装
npm install -g dsh-skills-nexus

# 2. 添加 skill 仓库
dsh-skills-nexus add github:owner/repo

# 3. 完事——DSH filesystem provider 会自动发现这些 skill
```

就这三步。npm 12 的三种安装路径、`EALLOWGIT` 故障排查、前置条件，见[安装说明](docs/install.zh-CN.md)。

## 能做什么

| 我想… | 运行… |
|---|---|
| 从任意 git 主机装一个 skill | `dsh-skills-nexus add github:owner/repo` |
| 锁到分支 / tag / commit | `dsh-skills-nexus add github:owner/repo#dev` |
| 从集合仓库只装一个子目录 | `dsh-skills-nexus add github:owner/repo --subdir skills/foo` |
| 链接 Trae / Qoder / CodeBuddy 里已装的技能 | `dsh-skills-nexus link trae-cn`（或 `trae`、`qoder`、`codebuddy`、`workbuddy`、`kimi-code`、`cursor`、`claude-code`、…） |
| 列出所有条目及状态 | `dsh-skills-nexus list` |
| 按组批量启停 | `dsh-skills-nexus enable --group trae-cn` |
| 把整机 skill 搬到另一台机器 | `dsh-skills-nexus export --all -o migrate.zip` → `dsh-skills-nexus import migrate.zip` |
| 健康检查（带退出码） | `dsh-skills-nexus doctor` |
| 面板里可视化管理 | 注册为 DSH 插件 → 设置 → Skills Nexus |

## Web 面板

注册为 DSH 插件（`dsh plugin add`）后，DSH 设置页会多出一个 **Skills Nexus** 段——浏览条目卡片、按组启停、URL 添加 skill、导入包、健康检查、长操作流式进度全部可视化。

面板能做的全部动作，见[完整面板描述](README_FULL.zh-CN.md#web-面板插件侧可选)。

## 工作原理

<p align="center">
  <img src="docs/assets/workflow.svg" alt="Git 仓库被克隆进 Nexus manifest，通过 symlink 进入 ~/.dsh/skills，由 DSH provider 自动发现；CLI 与 Web 面板驱动同一份 manifest" width="720"/>
</p>

CLI 和 Web 面板驱动同一份 manifest、同一批克隆、同一套跨进程文件锁。两边可以混用——一边正在操作的 skill，另一边会显示 `busy` / `locked`。

<details>
<summary>link 通道的工作方式</summary>

`link trae-cn` / `link trae` / `link qoder` 等会创建**外部条目**，symlink 指向你已有的目录（`~/.trae-cn/skills/`、`~/.trae/skills/`、…）。Nexus 从不克隆、更新、也不删除这些目录——`remove` 只删链接和 manifest 条目。

每个客户端是独立命名空间。同一 skill 装在两个客户端里会生成两条条目，不会互相遮蔽。默认目录可通过 `--source-dir` 覆盖。

</details>

## 用这个还是 `dsh plugin add`？

| 安装的是… | 需要 `dsh.bundle.patch`？ | 命令 |
|---|---|---|
| 纯 SKILL.md 内容仓库 | **否** | `dsh-skills-nexus add github:owner/any-skill` |
| 带 Cordis 封装的真 DSH 插件 | 是 | `dsh plugin add github:owner/dsh-skills-nexus` |

如果你的仓库两者都有，自己选——nexus 管内容，`dsh plugin` 管代码封装。[完整决策指南](docs/nexus-vs-plugin.zh-CN.md)。

## 路线图与已知限制

- **v0.10.x**：项目级技能仍是实验性的，CLI 交互可能调整；全局技能已稳定。
- **v0.11**：opt-in 匿名使用统计，让我们知道到底有多少人在用。
- **默认零上报**：什么都不发——除非你明确选择加入。
- **只用于 skill 内容仓库**：不是 `dsh plugin add` 的替代品。

欢迎提 issue——[直接开空白 issue](https://github.com/xiaxi626/dsh-skills-nexus/issues/new) 或选一个[模板](https://github.com/xiaxi626/dsh-skills-nexus/issues/new/choose)。

## 文档索引

完整参考在 `README_FULL.zh-CN.md`——每个 flag、每个边界情况、每个踩过的坑。下面是跳转指南：

| 我想… | 读… |
|---|---|
| 安装它 | [安装说明](docs/install.zh-CN.md) |
| 每个 `dsh-skills-nexus` 子命令详解 | [使用参考](README_FULL.zh-CN.md#使用) |
| 所有支持的 `link` 来源（Trae / Qoder / CodeBuddy / …） | [支持 link 的外部来源](README_FULL.zh-CN.md#支持-link-的外部来源) |
| 把 skill 限定在某个项目文件夹作用域 | [项目技能](README_FULL.zh-CN.md#项目技能) |
| 跨机器搬运 skill | [导出 / 导入 / adopt](README_FULL.zh-CN.md#跨机器搬运-skillexport--import) |
| 用 `--json` 写脚本 | [选项、--json 与 add 检查](README_FULL.zh-CN.md#选项--json-与-add-的检查) |
| Web 面板能做什么 | [Web 面板](README_FULL.zh-CN.md#web-面板插件侧可选) |
| 彻底卸载 | [卸载](README_FULL.zh-CN.md#卸载) |
| 不用 GitHub / npm 本地测试 | [本地测试步骤](README_FULL.zh-CN.md#本地测试步骤) |
| 架构、SKILL.md 发现规则、稀疏检出 | [架构](docs/ARCHITECTURE.zh-CN.md) |
| 在 nexus 之上构建工具 | [在 nexus 之上构建](docs/build-on-nexus.zh-CN.md) |
| nexus vs `dsh plugin` —— 该用哪个 | [nexus 与 plugin](docs/nexus-vs-plugin.zh-CN.md) |
| Subdir 设计取舍 | [Subdir 设计](docs/subdir-design.md) |

社区验证演练：[link 来源](docs/verify-link-sources.zh-CN.md) · [项目技能](docs/verify-project-skills.zh-CN.md) · [版本锁定](docs/verify-version-lock.zh-CN.md) · [导入导出](docs/verify-import-export.zh-CN.md) · [doctor](docs/verify-doctor.zh-CN.md) · [rollback](docs/verify-rollback.zh-CN.md) · [分组操作](docs/verify-group-operations.zh-CN.md) · [命令补全](docs/verify-completions.zh-CN.md) · [purge](docs/verify-purge.zh-CN.md) · [更新流水线](docs/verify-plugin-install.md) · [switch-version](docs/verify-switch-version.md) · [add/update JSON](docs/verify-version-lock.zh-CN.md)

## 卸载

三个独立的东西各用各的命令清理。完整步骤见[卸载](README_FULL.zh-CN.md#卸载)。

```bash
dsh-skills-nexus remove '*' --yes          # 1. 清掉所有 skill（数据）
dsh plugin --profile web remove dsh-skills-nexus   # 2. 可选：清理插件层
npm uninstall -g dsh-skills-nexus           # 3. 卸载全局 CLI
```

## 许可证

MIT。
