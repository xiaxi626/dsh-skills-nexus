# dsh-skills-nexus

[![CI](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml)

通用 DSH skill 适配器。**安装一次**，就可以把任意 GitHub 上的 `SKILL.md` 仓库注册为 DSH skill——一条命令添加一个。skill 仓库本身保持纯净：不需要 Cordis 插件代码，不需要 `package.json`，也不需要 `cordis.patch.yml`。

本项目把「薄包装层」模式从「单个硬编码 skill」推广为「N 个动态发现的 skill」——同一个 provider 可以承载多个 skill，运行时扫描目录并注册。

## 架构概览

```mermaid
flowchart LR
    subgraph 用户命令行
        A["<b>dsh-skills-nexus CLI</b><br/>add · update · remove"]
    end

    subgraph 本地存储
        M["<b>manifest.json</b><br/>状态后端"]
        S["<b>~/.dsh/skills-nexus/skills/</b><br/>repo-a/ SKILL.md<br/>repo-b/ SKILL.md"]
    end

    subgraph DSH 运行时
        P["<b>nexusProvider</b><br/>list() · get(name)"]
        C["ctx.skills<br/>（DSH skill 目录）"]
    end

    G[("GitHub<br/>SKILL.md 仓库")]

    A -- "git clone" --> G
    A -- "读写" --> M
    M -- "启动时读取" --> P
    S -- "读取 SKILL.md" --> P
    P -- "注册" --> C

    style A fill:#e8f4fd,stroke:#3b82f6,stroke-width:2px,color:#000
    style P fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#000
    style M fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#000
    style S fill:#f5f3ff,stroke:#8b5cf6,stroke-width:2px,color:#000
    style C fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#000
    style G fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#000
```

- **CLI 管写入**：`add` / `update` / `remove` 等命令操作 git 并写 `manifest.json`
- **Provider 管读取**：DSH 启动时 `list()` 扫描所有克隆目录、`get()` 返回 skill 正文
- **两边解耦**：CLI 和 provider 通过 manifest.json 通信，互不依赖

## 为什么需要它

`dsh plugin --profile <name> add "github:owner/repo"` 转发给 pnpm，且**只有声明了 `dsh.bundle.patch` 的包才会被激活为 profile layer**。一个只含 `SKILL.md` + `references/` + `scripts/` 的内容仓库没有 Cordis 封装，走不通这条路。`dsh-skills-nexus` 填补了这个缺口：

| 命令 | 安装的是什么 | 需要 `dsh.bundle.patch`？ |
|---|---|---|
| `dsh plugin add github:owner/dsh-skills-nexus` | nexus 本身（仅一次） | 是 |
| `dsh-skills-nexus add github:owner/any-skill` | 纯 SKILL.md 内容仓库 | **否** |

> **不确定自己的仓库该用哪个命令？** 请看
> **[nexus 与 `dsh plugin`——什么时候用哪个](docs/nexus-vs-plugin.zh-CN.md)**。
> 一句话版：仓库里有 `SKILL.md` → 用 nexus；是纯插件（`cordis.patch.yml` / `dsh.bundle.patch`，无 `SKILL.md`）→ 用 `dsh plugin`；两者都有 → 自己选（nexus = 要内容，plugin = 要代码）。

## 安装 nexus

```bash
dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

重启一次 profile。之后 nexus provider 就会在 `ctx.skills` 中持续生效。`lib/` 编译产物已随仓库提交，安装即用。

## 使用

```bash
# 注册一个 skill 仓库（克隆到 ~/.dsh/skills-nexus/skills/<name>/ 下）
dsh-skills-nexus add github:owner/repo
dsh-skills-nexus add github:owner/repo#dev          # 指定分支 / tag
dsh-skills-nexus add https://github.com/owner/repo
dsh-skills-nexus add owner/repo                     # 简写

# 查看 / 维护
dsh-skills-nexus list                               # 列出所有已注册 skill（含安装的 commit）
dsh-skills-nexus update [name]                      # 刷新（分支 pin 拉取；tag/commit pin 校验）
dsh-skills-nexus enable  <name>                     # 在目录中显示（默认开启）
dsh-skills-nexus disable <name>                     # 隐藏但不删除
dsh-skills-nexus remove <name>                      # 删除克隆 + 注销
```

支持的仓库格式：`github:owner/repo[#ref]`、完整 `https://` URL（含 `/tree/<ref>/...` 子路径）、`git+https://`、`git@`/`ssh://`、以及裸写 `owner/repo` 简写。

`add` 会在注册前检查克隆下来的仓库类型：

- **纯 SKILL.md 仓库**：直接注册。
- **SKILL.md + DSH 薄包装层**：询问是否忽略包装层、按普通 SKILL.md 仓库管理。输入 `y` 继续，输入 `n` 中止并建议按 DSH 插件方式安装。使用 `--yes` 可跳过确认。
- **纯 DSH 插件（没有 SKILL.md）**：提示请按该仓库自己的 DSH 插件安装方式安装，不建议用 nexus 管理，然后退出，不注册。
- **两者都不是**：提示未找到 SKILL.md 或 DSH 插件标记，报错退出。

## SKILL.md 发现规则（每个克隆仓库内）

1. `<repoRoot>/SKILL.md` — 优先级最高；整个仓库作为单个 skill。
2. `<repoRoot>/<name>/SKILL.md` — 仓库按子目录打包多个 skill（仅单层，与官方 filesystem provider 一致；嵌套的 `**/SKILL.md` 被排除）。
3. `<repoRoot>/<name>.md` — 扁平 Markdown 文件（无配套资源）。

扁平扫描会跳过 `README.md` / `CHANGELOG.md` / `LICENSE.md`。

### 支持的 frontmatter 字段

必填：`name`、`description`。可选且被 provider 识别：
`disable-model-invocation`（布尔）、`user-invocable`（布尔）。其余字段
（`whenToUse`、`metadata` 等）会被解析并保留，但 nexus 不做进一步解释。

## 文件系统布局

```
~/.dsh/skills-nexus/
├── manifest.json          # 状态后端：CLI 写，provider 读
└── skills/
    ├── repo-a/            # 完整 git 克隆，不做任何改动
    │   ├── SKILL.md
    │   └── references/…
    └── repo-b/
```

可用 `DSH_HOME`（默认 `~/.dsh`）或 `DSH_SKILLS_NEXUS_HOME`（默认 `<DSH_HOME>/skills-nexus`）覆盖根目录。

## 卸载

分两个层级，按需选择：

### 卸载单个 skill

```bash
# 查看已注册的 skill
dsh-skills-nexus list

# 删除一个（删除克隆目录并注销）
dsh-skills-nexus remove <skill-name>
```

下次 DSH 重载后该 skill 从目录中消失，不影响其他已注册的 skill。

### 卸载 nexus 本身

```bash
# 1. （可选）先删除所有已管理的 skill，清理 ~/.dsh/skills-nexus/ 目录
dsh-skills-nexus remove <name1>
dsh-skills-nexus remove <name2>
# ...

# 2. 从 DSH profile 中卸载插件
dsh plugin --profile web remove dsh-skills-nexus

# 3. （可选）删除残留状态
#    macOS / Linux:
rm -rf ~/.dsh/skills-nexus
#    Windows PowerShell:
# Remove-Item -Recurse -Force ~/.dsh/skills-nexus
```

重启 DSH profile。`dsh-skills-nexus` provider 及其所有 skill 都会被移除。

## 本地测试步骤

不需要推 GitHub、不需要发 npm，按以下五步在本机完整验证。

### 第一步：把项目编译出来

在 `dsh-skills-nexus/` 目录下：

```bash
cd dsh-skills-nexus
npm install
npm run build      # 生成 lib/ 目录
```

> 如果改了代码想先确认类型无误再编译，可以跑 `npm run typecheck`（只检查类型，不生成产物）。

### 第二步：创建本地 overlay

在项目根目录下新建 `overlay.yml`（注意：**不要提交到 git**，它是本地开发专用的）：

```yaml
# overlay.yml
- insert:
    - id: dsh-skills-nexus
      # Windows: '/C:/你的路径/dsh-skills-nexus/lib/index.js'
      # macOS:   '/Users/你的路径/dsh-skills-nexus/lib/index.js'
      # Linux:   '/home/你的路径/dsh-skills-nexus/lib/index.js'
      name: '/你的/绝对/路径/dsh-skills-nexus/lib/index.js'
```

> `name` 填 `lib/index.js` 的**绝对路径**。Windows 必须在盘符前加 `/`，例如 `'/C:/dev/dsh-skills-nexus/lib/index.js'`；macOS / Linux 直接用绝对路径，例如 `'/home/user/dsh-skills-nexus/lib/index.js'`。

**也可以用命令一键生成**（确保已 cd 到项目目录）：

**Windows (Git Bash / MINGW)：**

```bash
cat > overlay.yml <<EOF
- insert:
    - id: dsh-skills-nexus
      name: '/$(pwd -W)/lib/index.js'
EOF
```

> `pwd -W` 输出 Windows 风格绝对路径（如 `C:/Users/xxx/dsh-skills-nexus`），前面必须加 `/`，拼接后得到 `/C:/Users/xxx/dsh-skills-nexus/lib/index.js`。
> Node.js ESM loader 在 Windows 上不认裸 `C:/...` 路径（会被当成 `c:` 协议），必须写成 `/C:/...` 或 `file:///C:/...`。

**macOS / Linux：**

```bash
cat > overlay.yml <<EOF
- insert:
    - id: dsh-skills-nexus
      name: '$(pwd)/lib/index.js'
EOF
```

> `pwd` 输出 Unix 风格绝对路径（如 `/Users/xxx/dsh-skills-nexus`），本身已以 `/` 开头，拼接后得到 `/Users/xxx/dsh-skills-nexus/lib/index.js`。

执行后项目根目录会自动生成正确的 `overlay.yml`，路径自动填充。

### 第三步：用 patch 模式启动 DSH

```bash
npx @deepseek-ai/dsh web --patch overlay.yml
```

这会把 nexus 作为临时 layer 挂载进当前 profile，provider 就注册上了。**每次改了代码重新 `npm run build` 后，重启 DSH 生效。**

### 第四步：用 CLI 加一个 skill 测试

> **注意**：本地测试过程中**不要移动项目文件夹**。如果你在 `npm link` 之后移动了项目位置，再次 `npm link` 会报 `EEXIST: file already exists`——因为全局里还留着旧位置的链接。处理方法见下文。

另开一个终端：

```bash
# 先把 CLI 链到全局，方便直接用 dsh-skills-nexus 命令
cd dsh-skills-nexus
npm link

# 加一个真实的 skill 仓库试试
dsh-skills-nexus add github:xiaxi626/theme-port-skill

# 查看是否注册成功
dsh-skills-nexus list
```

**如果移动过文件夹，`npm link` 报 EEXIST 的处理方法：**

```bash
# 删除旧的全局链接（Git Bash / macOS / Linux）
rm -f ~/AppData/Roaming/npm/dsh-skills-nexus
rm -f ~/AppData/Roaming/npm/dsh-skills-nexus.cmd

# 然后重新链接
npm link
```

> 上面路径适用于 Windows + Git Bash。如果你用的是 macOS 或 Linux，全局链接通常在 `/usr/local/bin/` 下。

### 第五步：在 DSH 里验证

> **注意**：第三步用 `--patch` 启动的 DSH 进程，是在第四步加 skill **之前**就跑起来的，因此直接在原来的 DSH 界面里问「你有哪些 skill」是看不到新 skill 的——provider 还没加载它。
>
> **必须先停掉再重启**：回到第三步启动 DSH 的那个终端，按 `Ctrl+C` 停掉进程，然后重新执行一遍：
> ```bash
> npx @deepseek-ai/dsh web --patch overlay.yml
> ```
> 重启后 DSH 会重新加载 provider，此时 `list()` 才会扫描到刚通过 CLI 添加的 skill。

重启完成后，在 DSH 会话里问一句「你有哪些 skill」或类似触发目录查询的话，看 `theme-port-skill` 是否出现在 skill 列表里。

---

## 更轻的验证（不启动 DSH 也能测核心逻辑）

如果只想验证「clone + 解析 + provider list/get」这条链路是否正常，不需要启动整个 DSH，可以写一个几行的 Node 脚本直接调 provider：

```js
// test-provider.mjs
import { nexusProvider } from './lib/provider.js'

const list = await nexusProvider.list()
console.log('list:', list.map(s => s.name))

const skill = await nexusProvider.get('theme-port-skill')
console.log('get:', skill.description.slice(0, 60))
console.log('content length:', skill.content.length)
```

```bash
node test-provider.mjs
```

> 前提：已经用 `dsh-skills-nexus add` 加过至少一个 skill。如果 `list()` 返回了预期的 skill、`get()` 返回了正文内容，说明整个薄包装层接缝都正常。

---

## 工作原理

```
dsh-skills-nexus add github:owner/repo
   └─ git clone --depth 1 →  ~/.dsh/skills-nexus/skills/<name>/
   └─ 写入一条 entry        →  ~/.dsh/skills-nexus/manifest.json

DSH 启动 / 重载
   └─ apply(ctx) → ctx.skills.registerProvider(() => nexusProvider)
        └─ list()   读 manifest、扫描每个 clone、返回 SkillCandidate[]
        └─ get(name) 读 SKILL.md，返回 { content: body, resourceBase }
```

provider 实现了标准的薄包装层接缝：

- `list()` 返回 `SkillCandidate` **数组**——一个 provider 承载多个 skill。
- `parseFrontmatter()` 在运行时读取 `SKILL.md`（代码里不重复维护 description）；用 `yaml` 包解析，与官方 `dsh-skill-filesystem` 一致。
- `resourceBase` **按 skill 构造**，指向该 skill 自己的 clone 目录，因此正文里的相对路径（`references/`、`scripts/`、`assets/`）能正确解析。
- skill 名称取自每个 `SKILL.md` frontmatter 的 `name` 字段（回落到 manifest 中的 key），因此多 skill 仓库也能正确呈现。

## 项目结构

```
src/
├── index.ts          # Cordis 插件入口：apply(ctx) → registerProvider
├── provider.ts       # nexusProvider：list() / get(name)
├── resolve.ts        # 将 manifest entries 解析为具体 skill
├── manifest.ts       # manifest.json 的读写/查找/增删/切换
├── locator.ts        # 在克隆目录中定位 SKILL.md（3 种发现布局）
├── frontmatter.ts    # 基于 yaml 的 frontmatter + body 解析
├── git.ts            # parseGitSpec / cloneRepo / pullRepo（execFile，无 shell）
├── paths.ts          # 根目录/skills/manifest 路径常量
├── types.ts          # Manifest / SkillCandidate / SkillDefinition / Context
└── cli/
    ├── index.ts      # 命令分发
    ├── args.ts       # 轻量 argv 解析
    └── commands/     # add · list · update · remove · toggle
```

运行时依赖只有 `yaml`。`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-skill` 是可选 peer 依赖（SDK 在运行时提供真实的 `Context`；`types.ts` 中的结构类型让项目在没有它们时也能通过类型检查）。

## 开发：测试与 CI

> **想端到端验证版本锁定功能？** 见
> [验证版本锁定功能（P0）](docs/verify-version-lock.zh-CN.md) —— 覆盖
> Windows / Linux / macOS 的可直接复制的验证流程：测试套件、分支快进、
> tag 固定点、漂移恢复与重复 add 保护。

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
| `src/resolve.ts` | `test/resolve.test.ts` | manifest → 解析后 skill 的完整管线（多 skill、开关、名称回退） |

`npm run test:build` 把 `src/` + `test/` 编译到 `test-dist/`，可无 loader 直接跑
（`node --test test-dist/test/`），适合 tsx loader 不可用的环境。

CI（`.github/workflows/ci.yml`）在 push/PR 时于 Node 18/20/22 上运行：
typecheck、lint、单元测试、build，以及「已提交的 `lib/` 是否与最新源码一致」的校验
（发布包直接带 `lib/`，编译产物过期会导致发布内容与源码漂移）。

## 注意事项与限制

- **add 后是否立即可见**：新添加的 skill 是否立即出现在目录中，取决于 DSH 是否缓存了 provider 的 `list()` 结果。如果 profile 在 add 之前已启动，重载一下即可（或依赖 nexus「每次 list 都重新读」的设计，在下一次目录刷新时自动拾取）。
- **版本固定与更新**：用 `#分支名`、`#tag名` 或 `#commit-hash` 固定 ref。安装时 manifest 会记录实际解析到的 commit（`commit` 字段）——一个轻量锁，`list` 会显示它。`update` 只对**分支** pin 的 skill 做快进拉取（并打印 commit 变化）；**tag/commit** pin 的 skill 是固定点：只校验当前 checkout 是否仍等于 pin（漂移则自动恢复），不做 pull——被固定的版本永远不会静默漂移。不加 `#ref` 时，CLI 会通过 `git ls-remote --symref` 自动探测远程默认分支（探测失败回落到 `main`）。
- **仅用于 skill 内容仓库**：这不是 `dsh plugin add` 的替代品。如果仓库本身就有 `dsh.bundle.patch`，请用正常方式安装——nexus 是给那些没有封装的仓库用的。完整决策指南见 [nexus 与 `dsh plugin`——什么时候用哪个](docs/nexus-vs-plugin.zh-CN.md)。
- **构建脚本**：由于 nexus 自己 clone 内容仓库（不走 pnpm），它完全绕开了 pnpm 的 `allowBuilds` 拦截。

## 许可证

MIT
