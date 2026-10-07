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

## 你可以依赖的接口

nexus 暴露四条机器可读路径。四条都是稳定契约；CLI 的其余一切都是面向人类的，可能变。

- **只读**：`list --names` 与 `doctor --json`（见下）。
- **写侧**：`add --json`、`update --json`、`remove --json`、`enable --json`、
  `disable --json`，以及 `list --json`——共用一份契约，见下方
  「`--json` 写接口（version 1）」。

### `list --names`——枚举已安装的 skill

- 每行一个 skill 名，按 manifest 顺序——无表头、无列补齐、无页脚。
- 空 manifest 输出**空串**（这条路径上刻意没有人类提示 "No skills registered."）。
- 退出码：`0` 正常列出、`1` manifest 不可读、`2` 用法错误。用法错误时 stdout 保持
  为空、错误信息只走 stderr——一个坏掉的调用绝不会被误当成"零个 skill"。
- `--names` 拒绝内联值：`--names=false` 是用法错误，而不会被静默当成 `true`。
- `--names` 与 `--json` **互斥**：它们是两种不同的机器形状，"两个都要"没有合理答案。

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
- 每条 issue 为 `{ severity, code, name, fix?, detail?, locked? }`，其中 `severity` 是
  `error` / `warn` / `info`。`code` 是稳定标识符：`corrupt-manifest`、
  `orphan-check-skipped`、`root-unreadable`、`missing-target`、`orphan-repo`、
  `orphan-link`、`dangling-link`、`unreadable-link`、`corrupt-backup`、
  `missing-git`，以及 `behind-remote` 和 `locked`（后两者仅在 `--updates` 下出现）。
- 退出码：`0` 无 error、`1` 至少一个 error、`2` 用法错误。
- `--updates` 追加一项联网检查，把分支 pin 与其远程比对。`locked` issue 仅在显式 package lock 时携带可选的 `locked: true`；普通 detached tag/commit pin 不带该字段。`--quiet` 在无 error 时不打印任何内容。
- `doctor` 是**只读**的——绝不写 manifest、克隆或 symlink。

每个检查项与 code 的完整含义、以及修复建议，见
[验证 `doctor` 命令](verify-doctor.zh-CN.md)。

## `--json` 写接口（version 1）

五个命令会输出带版本号的报告，描述它们**刚才做了什么**：`list --json`、
`add --json`、`update --json`、`remove --json`，以及 `enable` / `disable --json`。
它们共用一份刻意保持窄小的契约：

### 承诺的部分

- **顶层 `version: 1`**。破坏性变更会递增到 `2`；请以该字段做门禁。
- **格式**：`JSON.stringify(report, null, 2)` 加一个末尾换行。
- **退出码**：`0` 成功 · `1` 有错误或部分失败 · `2` 用法错误。单项失败（三个仓库里
  有一个克隆失败）是退出 `1` **外加一份完整报告**，因此你不必重新查询就知道是哪一项。
- **stdout 纯净**：带 `--json` 时 stdout 只有报告文档本身。命令原本会打印的每一行
  人类文本都被抑制，所以 `JSON.parse(stdout)` 前面永远不需要过滤器。
- **诊断仍走 stderr**，且明确**不属**契约。运行过程可能在那里输出警告；那是给人看
  的，不是给程序读的。

### 不承诺的部分

- **对象键顺序**。字段名与类型是契约，顺序不是。
- **人类输出的措辞**。不带 `--json` 时文本与从前完全一致——但措辞本身从来不是契约。
- **`error` 的具体文本**。只承诺存在 `error` 字段，字符串可能在任何版本变化。
- **`links[].target` 的路径格式**。是绝对路径，随平台变化。

### 从不提示

`--json` 运行是非交互的（`interactive: false`），提示一律按默认值回答。因此凡是原本
会发问的步骤——wrapped 仓库询问、大集合护栏、通配符匹配到多个 skill——都会**被拒绝**
而不是被确认。人类运行下会被问到的操作，请显式传 `--yes`；拒绝会体现在报告里
（`status: "skipped"`，或多匹配通配符的 `status: "not-found"` / 退出 `2`），而不是
无声无息。

### 报告

`list --json`：

```json
{
  "version": 1,
  "entries": [
    {
      "name": "daily-trend-writer",
      "url": "github:owner/repo",
      "ref": "main",
      "subdir": null,
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "locked": true,
      "hasGitSource": true,
      "ownership": "managed",
      "enabled": true,
      "links": [{ "linkName": "daily-trend-writer", "target": "/abs/path" }],
      "update": null
    }
  ]
}
```

- `hasGitSource` 是服务端谓词（`gitUrl.length > 0`），**不是**从 `url` 推导——每个
  条目都有 `url`、且永不为空。它决定条目是否可自动更新。
- `ownership` 为 `managed`（`repos/<path>` 由 nexus 创建）或 `external`（`--link-only`
  收编、只链接用户自己的目录；`remove` 绝不删该目录）。
- `commit` 是登记的 lockfile-lite 值，未登记过则为 `null`，不是现场 `git rev-parse`。
- `locked` 仅对 `import --locked` 创建的显式 package lock 出现且为 `true`；普通条目省略该字段。
- `update` 为 `null`（本进程从未检查）或
  `{ "hasUpdate": bool, "latestCommit": string|null, "checkedAt": ISO }`。

`add --json`：

```json
{
  "version": 1,
  "results": [
    { "spec": "github:o/r", "status": "added", "name": "r", "commit": "abc",
      "ref": "main", "links": ["r"] }
  ],
  "summary": { "added": 1, "skipped": 0, "failed": 0 }
}
```

- `status` ∈ `added` | `skipped` | `failed`。`skipped` 与 `failed` 带 `code`（安装核心
  给出的停止原因，若有：`no-skill-md`、`no-installable-skills`、`subdir-not-found`、
  `dsh-plugin-repo`、`aborted`）或 `error`（前置检查自己的说明：`already-registered`、
  `collision`、`locked`）。
- 只有给了 `--subdir` 时才出现 `subdir` 字段。

`update --json`：

```json
{
  "version": 1,
  "results": [
    { "name": "r", "status": "updated", "ref": "main",
      "fromCommit": "abc", "toCommit": "def" }
  ],
  "summary": { "updated": 1, "failed": 0 }
}
```

- `status` ∈ `updated` | `up-to-date` | `pinned` | `failed`。`pinned` 表示克隆处于
  tag/commit 固定态，只做了校验而没有移动。
- 失败时 `toCommit` 为 `null`。不写名字的 `update --json` 覆盖所有已启用条目。

`remove --json`：

```json
{
  "version": 1,
  "results": [{ "name": "r", "status": "removed", "links": ["r"] }],
  "summary": { "removed": 1, "failed": 0 }
}
```

- `status` ∈ `removed` | `not-found` | `failed`。匹配不到任何东西的通配符会以
  「原样给出的模式名 + `not-found`」单独成项。

`enable` / `disable --json`（与 `remove` 一样接受多个名字）：

```json
{
  "version": 1,
  "results": [
    { "name": "r", "action": "enable", "status": "toggled",
      "enabled": true, "linksChanged": 1, "already": false }
  ],
  "summary": { "toggled": 1, "already": 0, "failed": 0 }
}
```

- `status` ∈ `toggled` | `already` | `not-found` | `failed`。
- `enabled` 是条目的**结果**状态：`not-found` 项报告的是它保持的状态，而不是被请求的
  状态。
- `linksChanged` 统计创建（enable）或删除（disable）的 symlink 数。

### 错误

- **用法错误**（命令拒绝的 argv）：退出 `2`。若调用方要了 `--json`，stderr 输出
  `{ "version": 1, "error": { "message": "…" } }`；stdout 保持为空。
- **未预期致命错误**：同样的形状写 stderr，退出 `1`。
- **单项失败**：进入报告的 `results[]`，退出 `1`。

## 没有的接口（动手前先读这段）

明确写清，好让你绝不去依赖 nexus 并未承诺的表面：

- **`export` / `import` / `adopt` / `switch-version` 没有 `--json`。** 它们刻意不在
  version 1 写契约内：`export` / `import` 涉及包格式，`adopt` / `switch-version` 是
  长任务、其结构化状态属于 HTTP job 通道。请用退出码驱动它们，再用 `list --json`
  重新查询。
- **没有流式 / 增量 JSON。** 每份报告在运行结束时一次性写完整。job 式的进度流不在
  本契约内。
- **`add` 会静默忽略未知 flag。** 这是对它众多选项的刻意宽容——打错的 flag 不会
  报错，只会按默认值运行。shell out 之前请自行校验 argv。（`--json=false` **会**被
  拒绝，因为把它静默读成 `true` 等于给你一份你没要的报告。）
- **没有 Cordis service / provider / hook。** 插件 `apply()` 是刻意的空操作——
  你**无法**在运行时通过 `ctx` 消费 nexus。skill 发现完全靠 symlink + 官方
  filesystem provider。
- **包内部不是公开 API。** CLI 是唯一受支持的接口。不要 `import` 包的子模块
  （`./resolve` 及其余一切），也不要读 `manifest.json`——内部 schema 与模块布局
  会不加通知地变动。这份解耦正是 `list --names` 与 `list --json` 存在的全部理由
  （同理，git 的补全调 `for-each-ref` 而非直读 `.git/refs/`）。

## 如何集成

- **shell out 调 CLI。** 按行读 `list --names`，把任何 `--json` 输出当 JSON 解析。
  随包发布的 shell 补全脚本就是参考消费者——它通过 `list --names` 取已安装名字，
  从不碰 `manifest.json`。
- **优先用 `--json`，而不是刮文本。** `nexus add gitlab:group/repo --json` 一次解析
  就给出落地的 commit、条目名与创建的链接；从人类输出里拿同样信息，等于用正则去匹配
  一份明确不是契约的散文。
- **尊重生态边界。** nexus 通过 `~/.dsh/skills/` 里 symlink 是否存在来控制 skill
  的**可见性**。另一类 skill 管理器改用 Policy 状态模型。若同一个 skill 被两者
  同时管理，两套模型可能打架（一边显示"关"、另一边还在加载）。若你在 nexus 之上做
  UI 或管理器，请占住这条边界的一侧，并在你的文档里写清。
- **自动化是安全的。** nexus 绝不执行克隆仓库里的任何东西、也绝不跑仓库的
  build/install 脚本，所以从守护进程或 CI 任务里调用它不会运行任何不可信代码。

## 稳定性与维护

- **稳定——可以依赖：** `list --names` 的输出形状与退出码；`doctor --json` 的
  `version` 字段、顶层形状、检查项 id、`status` 枚举、issue 的 `code` 取值、以及
  退出码；以及每个 `--json` 命令的 `version` 字段、报告形状与字段名、`status` 枚举、
  和上述退出码含义。
- **不稳定：** `list` 的人类表格输出；`doctor` 的人类报告文本；任何报告里的
  `error` / `detail` 消息字符串；报告对象内部的键顺序；任何通过 import 包内部或读
  `manifest.json` 得到的东西。
- 当某个 `version` 递增时，说明那份 JSON 契约发生了破坏性变更——请固定到你测试过的
  版本并据此做门禁。
