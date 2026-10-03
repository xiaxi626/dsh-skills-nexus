# 来源与包

> **中文** | [English](sources-and-packages.md)

技能如何进入 nexus，以及如何打包搬运。

## 来源通道

技能通过四条通道进入 nexus。每条通道都会在 `manifest.json` 中产生一个条目；条目的可更新性取决于它是否携带 git 源。

| 通道 | 命令 | 身份来源 | 可更新 | 典型场景 |
|---|---|---|---|---|
| A | `add <spec>` | 克隆所得的 `url + ref + commit` | 是 | 公开或私有 git 仓库 |
| B | `import <dir>` | 从 `.git` remote 或元数据探测；无则空 | 探测到 → 是；否则冻结 | 磁盘上已有的技能、遗留目录 |
| C | `export` / `import <pkg>` | 包内的 `nexus-package.json` 标签 | 标签含 url 且可达 → 是；否则冻结 | 跨机器迁移、离线交付 |
| D | `adopt <name> --url` | 用户显式给出 | 操作完成后 → 是 | 冻结条目后来找到了它的仓库 |

## 通道 A：git 源（`add`）

```bash
dsh-skills-nexus add github:owner/repo
dsh-skills-nexus add github:owner/repo --ref v1.0 --subdir skills/foo --name my-skill
```

`add` 克隆仓库，用官方 DSH filesystem provider 相同的规则发现技能，归一化 frontmatter，在 `~/.dsh/skills/` 创建符号链接，并在条目中记录 `url`、`gitUrl`、`ref`、`commit`。条目从一开始就可更新。

| 参数 | 作用 |
|---|---|
| `--ref <分支/标签/提交>` | 锁定版本（默认：远端默认分支） |
| `--subdir <路径>` | 安装集合仓库的某个子目录 |
| `--name <名称>` | 覆盖条目名（默认：仓库 slug 或 subdir 末段） |
| `--yes` | 跳过确认提示 |

多个 spec 独立安装：`add A B` 克隆两个仓库。每仓库参数（`--name`、`--ref`、`--subdir`）只适用于单个仓库，与多个 spec 同时使用时会被拒绝。

完整的克隆 → 归一化 → 链接流程及文件系统布局见 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)。

## 通道 C：包（`export` / `import`）

包是**搬运容器**，不是第二种安装格式。它携带技能文件*和*一份 `nexus-package.json` 标签，记录每个条目的来源（`url` / `gitUrl` / `ref` / `commit` / `subdir`）、启用状态、以及它拥有的链接。导入方优先按记录的来源重新获取；文件是后备。

### 导出

```bash
dsh-skills-nexus export <name>... -o <file>
dsh-skills-nexus export --all                          # 所有受管条目
```

产出一个包（`.zip` 归档或目录树，由输出文件扩展名决定）。包结构：

```
nexus-package.json          # 带来源元数据的标签
skills/<name>/...           # 每个技能一条完整文件树
```

导出内容 = 条目技能根（`subdir` 之后的部分）的原文。**包内一律不含 `.git`、不含任何凭据。**

| 参数 | 作用 |
|---|---|
| `<name>...` | 按名称导出指定条目 |
| `--all` | 导出所有受管条目（含禁用条目） |
| `-o <file>` | 输出路径（默认：单条目 `<name>.zip`，`--all` 时为 `nexus-export-<YYYYMMDD>.zip`） |

标记为 `ownership: 'external'` 的条目恒定跳过——它指向用户自己的目录，nexus 既不读也不搬。跳过的条目记入标签的 `skipped[]` 数组。

### 导入

```bash
dsh-skills-nexus import <file|dir>
dsh-skills-nexus import <file> --dry-run                 # 仅预览
dsh-skills-nexus import <file> --no-remote               # 强制落快照
```

接收一个包（zip 或目录）并从中重建条目。

| 参数 | 作用 |
|---|---|
| `--dry-run` | 预览将要发生什么，不触碰 nexus 状态 |
| `--no-net-check` | 跳过远端可达性检测（零等待，离线安全） |
| `--no-remote` | 即使标签记录了可达 url，也强制落快照 |
| `--name <名称>` | 覆盖条目名（仅适用于单条目包） |
| `--subdir <路径>` | 只从包中导入一个候选根 |
| `--each` | 每个候选根一个条目（N 个条目 = N 份独立副本） |
| `--force` | 替换已注册的同名条目 |

**候选根扫描（剥壳）。** 第三方包的布局千奇百怪——常见模式是 `skills/<name>/SKILL.md` 外面多一层包装目录。导入通过逐层剥壳扫描候选根，每层剥一个包装目录，复用 `add` 使用的同样三条发现规则：

```
root = 解压根; peel = 0
循环:
  skills = locateSkillFiles(root)
  如果找到 skills: 候选根 = root; 跳出
  如果 root 恰有 1 个子目录且 peel < 3: root = 该子目录; peel++; 继续
  跳出 → 无候选
```

| 包内形态 | 剥壳次数 | 结果 |
|---|---|---|
| `SKILL.md` | 0 | 候选根 = 解压根 |
| `alpha/SKILL.md`（+ `beta/SKILL.md`） | 0 | 候选根 = 解压根，2 个技能 |
| `skills/alpha/SKILL.md` | 1 | 候选根 = `skills/`，技能 = `alpha` |
| `export-2026/skills/alpha/SKILL.md` | 2 | 候选根 = `export-2026/skills/` |

剥壳上限：3 层（最深命中 4 层）。超过上限且更深处确有 `SKILL.md` 时，报错 `skill-nested-too-deep`（附实际深度与位置，以及 `--subdir` 提示）。

**逐条目判定。** 对每个候选根，导入器检查标签记录的 url 是否可达：

| 条件 | 结果 |
|---|---|
| 标签含 url，url 可达 | 从 git 重新克隆——可更新条目 |
| 标签含 url，url 不可达 | 快照（冻结），附 `(url unreachable)` 说明 |
| 标签含 url，检测超时（默认 5s） | 快照，附 `(url check timed out)` 说明 |
| 无标签（裸包） | 快照，附 `(source unknown)` 说明 |

`--no-net-check` 完全跳过可达性检测；所有条目显示 `(not checked)` 而非 `unreachable`。

**状态还原。** 标签记录导出时的 `enabled` 和链接名。导入时原样还原——源机器上禁用的技能在目标机器上保持禁用。

**范围选择**（与 git 的 `--subdir` 对称）：

| 形式 | 语义 | 条目数 |
|---|---|---|
| 默认 | 整包一个条目 | 1 |
| `--subdir <路径>` | 只装一个候选根 | 1 |
| `--each` | 每个候选根一个条目 | N（N 份独立副本） |

**清单变体。** 如果包只含标签而没有任何技能内容，导入不创建任何条目或链接——它报告"该包不含技能内容"，并把标签中的每个条目列为建议动作（add / adopt / 落快照）。是否执行由用户决定。

### `--dry-run` 输出契约

`import --dry-run` 打印（并支持 `--json` 供机器消费）：

```
package: claude-skills.zip (zip) · manifest: none (source unknown)
  skills/alpha      name=alpha-skill   will import as snapshot (source unknown)
  skills/beta       name=beta-skill    will import as snapshot (source unknown)
```

判定只有一条分叉线：**包里有没有标签、标签里的 url 此刻是否可达**。四态：

| 条件 | 输出 |
|---|---|
| 标签 + url 可达 | `will clone from <url> (<ref>)` |
| 标签 + url 不可达 | `will import as snapshot (<url> unreachable)` |
| 标签 + 检测超时 | `will import as snapshot (<url> check timed out)` |
| 无标签（裸包） | `will import as snapshot (source unknown)` |

## 通道 D：补正身份（`adopt`）

```bash
dsh-skills-nexus adopt <name> --url <git-url> [--ref <r>] [--subdir <p>] [--force] [--prune]
```

给冻结条目（无 git 源）一个身份，把它变成与 `add` 创建的完全同质的可更新条目。条目保留其名称和 `path`；只有克隆被替换。

前置：条目当前无 git 源。用 `--force` 对已有 git 源的条目换源。

| 参数 | 作用 |
|---|---|
| `--url <仓库>` | **必需。** 要克隆的仓库——adopt 从不猜测 |
| `--ref <ref>` | 分支、标签或提交（默认：远端默认分支） |
| `--subdir <路径>` | 仓库相对的技能根 |
| `--force` | 对已有 git 源的条目换源 |
| `--prune` | 成功后删除预 adopt 备份 |

**七步编排**（与 `switch-version` 同构）：

1. 解析 `url/ref`，克隆到临时目录 `repos/.adopt-stage-*`
2. 用与安装相同的规则发现技能；与条目当前技能集比对——不一致默认拒绝（`--force` 绕过）
3. 备份当前目录：`repos/<path>` → `repos/<path>.pre-adopt-<ts>`
4. 临时目录就位为 `repos/<path>`
5. 重建链接：删旧集，按新发现结果建新集
6. 更新 manifest：写入 `url/gitUrl/ref/commit/subdir`，刷新 `updatedAt`
7. `--prune` 时删除备份，否则报告备份路径

**失败回退。** 任一步失败：恢复备份目录，还原旧链接集，manifest 不变，非零退出并输出原因。回退是 best-effort（吞掉自身的错误，与 `rollbackSwitch` 同款模式）。

**边界。** 不改条目名。不改链接名（重建所需的除外）。**不猜测 url**——调用方必须显式给出。

## 包格式：`nexus-package.json`

```json
{
  "schema": "dsh-skills-nexus/package",
  "version": 1,
  "exportedAt": "2026-10-02T00:00:00Z",
  "generator": "dsh-skills-nexus 0.4.0",
  "skipped": [
    { "name": "local-notes", "reason": "external (link-only)" }
  ],
  "entries": [
    {
      "name": "daily-trend-writer",
      "url": "github:trae-community/trae-skills",
      "gitUrl": "https://github.com/trae-community/trae-skills.git",
      "ref": "main",
      "commit": "abc1234",
      "subdir": "skills/daily-trend-writer",
      "enabled": true,
      "skills": [
        {
          "root": "skills/daily-trend-writer",
          "name": "daily-trend-writer",
          "description": "...",
          "links": ["daily-trend-writer"]
        }
      ]
    }
  ]
}
```

| 字段 | 必需 | 规则 |
|---|---|---|
| `schema` / `version` | 是 | `version` 更大 → 拒绝并提示升级；更小 → 尽力而为 |
| `entries[].name` | 是 | 建议条目名；`--name` 或冲突策略可覆盖 |
| `entries[].gitUrl` / `ref` / `subdir` | 否 | 有则优先走 git 通道；无则落快照 |
| `entries[].commit` | 否 | 仅作参考，不用于校验 |
| `entries[].enabled` | 否 | 导出时的启用状态；导入时**还原**（缺省视为启用） |
| `entries[].skills[]` | 否 | 候选技能与链接名；供 `--dry-run` / 面板预览使用 |
| `skipped[]` | 否 | 导出时跳过的条目及原因；导入侧据此提示用户手工处理 |
| 未知字段 | — | 忽略（向前兼容） |

**安全（导出侧）。** 包内一律不含 `.git`（遍历时跳过）。条目路径中的绝对路径、`..`、`:` 段、NUL 字节和空名被拒绝（zip-slip 防御）。符号链接被跳过。带凭据的 URL（`https://user:token@host`）被拒绝。

**安全（导入侧）。** 解包时沿用同一套限制。外部包一律不得携带 `.git`（发现即拒绝该条目）。

## 条目的三种存储形态

manifest 中每个条目取三种形态之一，决定 `remove` 如何处置它：

| 形态 | 目录归谁 | 可更新 | `remove` 的处置 | 判据 |
|---|---|---|---|---|
| git 克隆 | nexus（`repos/<path>`） | 是 | 删链接 + 删克隆 + 反注册 | `gitUrl` 非空 |
| 快照副本 | nexus（`repos/<path>`） | 否 | 同 git 克隆 | `gitUrl` 为空 |
| 外部目录 | **用户自己的** | 否 | **只删链接与注册，绝不删目录** | `ownership: 'external'` |

可更新性判据是 `src/manifest.ts` 中的 `hasGitSource(entry)`——当 `gitUrl.length > 0` 时为真。外部条目的 `gitUrl`、`ref`、`commit` 均为空，因此 `hasGitSource` 对它恒为假，`update` / `switch-version` 总是以 `400 not-a-git-clone` 拒绝。

## 不变量

- **可更新当且仅当有 git 源。** 条目记录了 `gitUrl`（且 `ref` 非空）→ `update` / `switch-version` 可用。无 git 源 → 以 `400 not-a-git-clone` 拒绝。
- **`path` 唯一。** 两个条目不能共享同一个克隆目录。
- **导入不覆盖既有条目名**，除非给出 `--force`。
- **`remove` 绝不删除 nexus 不所有的目录。** 外部条目只失去链接与注册。
- **`adopt` 失败是原子的。** 目录、链接、manifest 恢复到操作前的状态。
- **包永不携带 `.git` 或凭据。** 包是信封，不是仓库。

## 错误码

所有错误沿用既有方言（`status + { error, data? }`）：

| 场景 | CLI | HTTP |
|---|---|---|
| 对无 git 源条目 `update` / `switch-version` | 明确文案 + 退出 1 | `400 not-a-git-clone` |
| 包内没有任何 `SKILL.md` | `no-skill-found` + 退出 1 | `400 no-skill-found` |
| 找到了但层级过深 | `skill-nested-too-deep`（含位置、深度与 `--subdir` 提示） | `400 skill-nested-too-deep` |
| 包无 `nexus-package.json` | 提示"来源未知（将落快照）"，**不算错误** | 同左（仍 2xx） |
| 同名冲突 | 拒绝；`--force` 可覆盖 | `409 already-registered` |

## 面板同构

Settings 面板镜像命令面：

| 命令 | 面板位置 | 备注 |
|---|---|---|
| `import` | "import package" 行：选文件 → `--dry-run` 预览（四态 + 候选根）→ 确认导入 | 预览显示"可更新 / 快照"的区别 |
| `adopt` | 每条目"attach source"动作（url + 可选 subdir） | 仅在无 git 源条目上出现 |
| `export` | "export all" 按钮 | 写 zip 到 `~/.dsh/skills-nexus/exports/`；面板以服务端正路径展示可复制 notice——没有下载按钮 |
