# 在 nexus 之上构建——面向工具开发者的机器接口

> [English](build-on-nexus.md) | **中文**

你想做一个工具——GUI 面板、同步守护进程、CI 任务、或更上层的安装器——把 GitHub
上的 `SKILL.md` 仓库装进 DSH。这篇文档就是你可以依赖的契约；同样重要的是，它明确
列出**没有承诺**的那些接口，让你不会把工具建在流沙上。

## 为什么在 nexus 之上构建，而不是自己重造

"把这个 GitHub skill 装进 DSH"听起来像是一次 `git clone`。其实不是。一个正确的
安装器要处理一堆琐碎、且跨平台的问题——而这些 nexus 已经全部解决，并藏在一条命令
背后：

- **仓库 spec 解析**——`github:owner/repo[#ref]`、完整 `https://` URL（含
  `/tree/<ref>/...` 子路径）、`git+https://`、`git@` / `ssh://`、以及裸
  `owner/repo` 简写，全部归一到同一份克隆。
- **带重试的克隆**——浅克隆 + 有上限的指数退避重试，网络抖动不会留下装了一半的
  skill。
- **ref 固定 + 一把锁**——用 `#ref` 固定分支、tag 或 commit；实际解析到的 commit
  被记为一把轻量锁。`update` 对分支 pin 做快进，但对 tag/commit pin 只做**校验**
  （漂移则恢复）——被固定的版本永远不会静默移动。
- **frontmatter 归一化**——安装时修正不合法的 kebab-case 名称、补全缺失的
  `description`，官方 provider 不会因为坏 frontmatter 而静默跳过某个 skill。
- **集合仓库**——`--subdir` 从一个 bundle 里只装一个 skill；平铺 `*.md` 文档被
  过滤掉；一次装超过 20 个 skill 会弹确认提示。
- **symlink 物化**——在 `~/.dsh/skills/` 里为每个 skill 建一个 symlink，Windows
  上按需用目录联接（junction）——不需要开发者模式、不需要管理员权限。
- **发现是免费的**——DSH 官方 filesystem provider 扫描 `~/.dsh/skills/` 并加载
  这些 skill，没有需要你编写或维护的自定义 provider。

以上全部零第三方依赖，Node ≥ 20 的地方都能跑。你的工具只要跑
`dsh-skills-nexus add …`、再通过下面两个稳定接口读回状态即可——不必自己重造
克隆 / 固定 / 归一化 / 建链，也不必在 Windows junction 和 frontmatter 的边角情况
上踩坑。

## 你可以依赖的接口（两个，都是只读）

nexus 只暴露两条机器可读的读取路径。二者都是稳定契约；CLI 的其余一切都是面向人类
的，可能变。

### `list --names`——枚举已安装的 skill

- 每行一个 skill 名，按 manifest 顺序——无表头、无列补齐、无页脚。
- 空 manifest 输出**空串**（这条路径上刻意没有人类提示 "No skills registered."）。
- 退出码：`0` 正常列出、`1` manifest 不可读、`2` 用法错误。用法错误时 stdout 保持
  为空、错误信息只走 stderr——一个坏掉的调用绝不会被误当成"零个 skill"。
- `--names` 拒绝内联值：`--names=false` 是用法错误，而不会被静默当成 `true`。

这是枚举已安装 skill 的**权威**方式。不要去解析 `manifest.json`——原因见下方的
"不做清单"。

### `doctor --json`——带版本号的健康报告

- 在 stdout 输出稳定且带版本号的报告，格式为 2 空格缩进的 JSON、末尾带换行。顶层
  形状：

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

- **检查项 id**，按顺序：`manifest`、`roots`、`symlinks`、`orphan-repo`、
  `orphan-link`、`git-sanity`，以及 `updates`（仅在带 `--updates` 时出现）。
- **`status`** 取值为 `ok`、`warn`、`error`、`update-available` 之一。
- 每条 issue 为 `{ severity, code, name, fix?, detail? }`，其中 `severity` 是
  `error` / `warn` / `info`。`code` 是稳定标识符：`corrupt-manifest`、
  `orphan-check-skipped`、`root-unreadable`、`missing-target`、`orphan-repo`、
  `orphan-link`、`dangling-link`、`unreadable-link`、`corrupt-backup`、
  `missing-git`，以及 `behind-remote` 和 `locked`（后两者仅在 `--updates` 下出现）。
- 退出码：`0` 无 error、`1` 至少一个 error、`2` 用法错误。
- `--updates` 追加一项联网检查，把分支 pin 与其远程比对；`--quiet` 在无 error 时
  不打印任何内容。
- `doctor` 是**只读**的——绝不写 manifest、克隆或 symlink。

每个检查项与 code 的完整含义、以及修复建议，见
[验证 `doctor` 命令](verify-doctor.zh-CN.md)。

## 没有的接口（动手前先读这段）

明确写清，好让你绝不去依赖 nexus 并未承诺的表面：

- **写侧没有机器可读输出。** `add` / `update` / `remove` / `enable` /
  `disable` 只打印人类文本——它们没有 `--json`、也没有结构化结果对象。请用
  **退出码**驱动它们，再用 `list --names` / `doctor --json` 重新查询状态。
- **`add` 会静默忽略未知 flag。** 这是对它众多选项的刻意宽容——打错的 flag 不会
  报错，只会按默认值运行。shell out 之前请自行校验 argv。
- **暂无 `list --json`。** 它被刻意留作独立的未来轨道；今天 `--names` 是枚举的
  唯一机器路径。即便将来它落地，`--names` 也会保留。
- **没有 Cordis service / provider / hook。** 插件 `apply()` 是刻意的空操作——
  你**无法**在运行时通过 `ctx` 消费 nexus。skill 发现完全靠 symlink + 官方
  filesystem provider。
- **包内部不是公开 API。** CLI 是唯一受支持的接口。不要 `import` 包的子模块
  （`./resolve` 及其余一切），也不要读 `manifest.json`——内部 schema 与模块布局
  会不加通知地变动。这份解耦正是 `list --names` 存在的全部理由（同理，git 的补全
  调 `for-each-ref` 而非直读 `.git/refs/`）。

## 如何集成

- **shell out 调 CLI。** 按行读 `list --names`、把 `doctor --json` 当 JSON 解析。
  随包发布的 shell 补全脚本就是参考消费者——它通过 `list --names` 取已安装名字，
  从不碰 `manifest.json`。
- **尊重生态边界。** nexus 通过 `~/.dsh/skills/` 里 symlink 是否存在来控制 skill
  的**可见性**。另一类 skill 管理器改用 Policy 状态模型。若同一个 skill 被两者
  同时管理，两套模型可能打架（一边显示"关"、另一边还在加载）。若你在 nexus 之上做
  UI 或管理器，请占住这条边界的一侧，并在你的文档里写清。
- **自动化是安全的。** nexus 绝不执行克隆仓库里的任何东西、也绝不跑仓库的
  build/install 脚本，所以从守护进程或 CI 任务里调用它不会运行任何不可信代码。

## 稳定性与维护

- **稳定——可以依赖：** `list --names` 的输出形状与退出码；`doctor --json` 的
  `version` 字段、顶层形状、检查项 id、`status` 枚举、issue 的 `code` 取值、以及
  退出码。
- **不稳定：** `list` 的人类表格输出；`doctor` 的人类报告文本；任何通过 import 包
  内部或读 `manifest.json` 得到的东西。
- 当 `doctor --json` 的 `version` 递增时，说明 JSON 契约发生了破坏性变更——请固定
  到你测试过的版本并据此做门禁。
