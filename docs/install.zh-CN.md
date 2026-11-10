# 安装说明

三种安装路径——按需选择即可。三种方式装完后都有 `dsh-skills-nexus` CLI；前两种还能把 nexus 放进 DSH web 插件层。

## 路径 1：npm registry 发布版（大多数用户推荐）

```bash
npm install -g dsh-skills-nexus
```

从 npmjs.com 拉取，不走 Git 依赖——**永远不需要** `--allow-git=all`。缺点是发布版落后于 GitHub 最新代码。

## 路径 2：直接从 GitHub（拿最新代码）

**npm 12+**（Git 依赖默认被阻止）：

```bash
npm install -g --allow-git=all github:xiaxi626/dsh-skills-nexus
```

**较旧的 npm**（未禁止 Git 依赖）：

```bash
npm install -g github:xiaxi626/dsh-skills-nexus
```

> **为什么两条命令？** npm 12 把 `allow-git` 从默认允许改为 `none`，所以 `github:owner/repo`
> 这种 Git 依赖现在需要显式放行。`npm --version` 看版本，`npm config get allow-git` 看当前策略。

## 路径 3：注册为 DSH 插件（启用 Web 面板）

这条路径把 nexus 作为 DSH 插件层装进 profile 并启用 Web 面板。它**不会**把 CLI 命令放进
你的 shell PATH——你仍然需要上面两条 npm 路径之一来获取 `dsh-skills-nexus` 命令。

```bash
dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

把 `web` 换成你实际使用的 profile 名。在 **web** DSH 会话里，这一步会注册 Skills Nexus 设置面板
及其 `/skills-nexus/*` HTTP 路由；非 web 宿主里该层保持沉默。

> **插件层是可选的。** skill 发现本身从不依赖它——技能靠 nexus 在 `~/.dsh/skills/` 建的
> symlink + 官方 filesystem provider 被发现与加载。全局 CLI 永远来自上面两条 npm 路径。

## 遇到 `EALLOWGIT` 怎么办？

```text
npm error code EALLOWGIT
npm error Fetching packages of type "git" have been disabled
```

这是 **npm 的 Git 依赖获取策略**在下载前拦截了安装，不是 Nexus 没装、也不是仓库构建失败。
npm 12 起，`allow-git` 默认从允许改为 `none`；`github:owner/repo` 属于 Git 依赖，因此需要显式放行。

### 这个错误**不**代表什么

- npm **没有**检测到 Nexus 的恶意代码
- Nexus **不是**与 npm 12 不兼容
- 你**不需要**为此重装 DSH 插件或降级 npm

### 怎么修

用路径 2 里带 `--allow-git=all` 的命令重跑一次即可。该参数只对本次调用生效，不会永久修改
npm 配置，也不代表依赖已过安全验证。

如果经常遇到，换路径 1（npm registry 发布版）更省心——那条路永远不走 Git 依赖。

### 背景：npm 为什么改策略

默认收紧是为了降低供应链风险：Git 依赖会访问远程仓库，并可能引入项目无法控制的配置。
命令行上显式加 `--allow-git=all` 是一次性、显式的信任确认。

> 不建议全局永久设置 `allow-git=all`。`dsh plugin add` 用的是 pnpm，配置独立于 npm——
> 插件安装成功不会改变 npm 的策略，反过来也一样。

## 前置条件

- **Node ≥ 20**（安装时会检查）
- `lib/` 编译产物已随仓库提交，**不需要** `npm run build`——装完就能用。

## 安装后得到的三样东西

三种安装方式装完后，你得到**互相独立**的三样东西，各自用不同命令清理：

| 是什么 | 在哪里 | 清理命令 |
|---|---|---|
| CLI 命令 | npm 全局 bin（PATH 上） | `npm uninstall -g dsh-skills-nexus` |
| skill 数据（克隆 + manifest） | `~/.dsh/skills-nexus/` | `dsh-skills-nexus remove '*' --yes` |
| 可选的 DSH 插件层 | `<profile>/node_modules/` | `dsh plugin --profile web remove dsh-skills-nexus` |

清掉一样**不会**连带清掉其他。完整卸载步骤见[旧版 README 的卸载章节](../README_FULL.zh-CN.md#卸载)。

## 还是拿不准？不知道该用哪条路径？

看 [nexus 与 `dsh plugin`——什么时候用哪个](nexus-vs-plugin.zh-CN.md) 做决策。一句话版：
仓库里有 `SKILL.md` → 用 nexus；是纯插件（`cordis.patch.yml` / `dsh.bundle.patch`，无 `SKILL.md`）
→ 用 `dsh plugin`；两者都有 → 自己选。
