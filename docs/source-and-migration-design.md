# 来源与移植设计备忘（技能的"从哪来"与"怎么搬"）

> 状态：设计决策记录 · 2026-10-02
> 结论：**退役「zip 作为安装方式」**，把"技能从别处来"重新定义为「四条来源通道 + 一个补正动作」。
> 动机：现有 `add-zip` 把两件不同的事混成一个能力——“某仓库某 ref 的归档安装”（有身份、可更新）
> 与“用户手里的一个包”（无身份、永久冻结）。它没有 `gitUrl/ref/commit`，因此永远不能更新；
> 发现规则又藏在 `locator.ts` 的三条隐式分支里（根 / 一层 `<name>/SKILL.md` / 根级 `*.md`），
> 于是集合仓库的 GitHub zip（`repo-main/skills/alpha/SKILL.md`，超出三层）根本装不了，
> 且"不是技能包"与"层级太深"报的是同一条错误。对公开仓库它严格劣于 `add`；
> 它唯一诚实的用途是**跨机器的搬运**。本设计据此重排。

---

## 1. 现状与出发点

1. **`add` 是唯一带身份的入口**：记录 `url + ref + commit`，因此可 `update`、可 `switch-version`、
   可被 `check-updates` 比较。
2. **`add-zip` 产出"无 git 源条目"**（且只有面板能调；CLI 无对应命令）：
   `list / enable / disable / remove` 可用，`update / switch-version` 被拒。
3. **一个包只有两种可能**：要么它来自某个仓库（那么原机上、或用户别处，通常还留着那个仓库），
   要么它根本没有仓库（手写、离线产物）。前者应当被**恢复成 git 条目**，后者只能当**快照**——
   而今天 zip 把两者一律当快照，这正是"永久冻结"的根源。

⇒ zip 不是安装方式，而是**搬运容器**。真正需要设计的是"来源"与"移植"。

### 1.1 两个目标场景（本设计的验收场景）

**场景 M（整机迁移）**：把本机的 nexus 状态——条目清单、每个条目的克隆、启用/禁用状态——导出成
一个包，在新机装好 nexus 后导入，**在新机上继续可管理、可更新**。

```bash
# A 机
dsh-skills-nexus export --all -o migrate.zip          # 包 = 技能内容 + 来路标签（不含 .git）

# B 机（新机）
dsh-skills-nexus import migrate.zip --dry-run         # 先看：哪些能恢复为 git 条目、哪些只能落快照
dsh-skills-nexus import migrate.zip
```

要点：① `--all` 必须**包含禁用条目**，且标签要记 `enabled` 与链接名，导入时**原样还原**
（原机禁用的技能不得在新机上自动启用）；② B 机**能连上仓库**时全部恢复为 git 条目（可更新、可切版本）；
③ B 机**连不上**时落成快照，联网后跑一次 `adopt <name> --url <url>` 即可转正——**包不携带 `.git`**，
这正是"包是信封、不是仓库"的含义（对照见 §4.1 的 v2 说明）。

**场景 P（第三方移植）**：把别的软件/别的 agent 导出的 skills 包搬进 nexus，使技能**能被 DSH 使用**
（在 `~/.dsh/skills/` 有顶层链接、frontmatter 已归一化）、且**能被 nexus 管理**（出现在 `list`，
可 `enable` / `disable` / `remove`）。

```bash
dsh-skills-nexus import claude-skills.zip --dry-run    # 第三方包：多半无标签 → 会列候选根 + 落快照
dsh-skills-nexus import claude-skills.zip --each       # 每个候选根一个条目
dsh-skills-nexus adopt <name> --url <git-url>          # 事后查到仓库地址 → 转成可更新条目
```

要点：第三方包的**布局千奇百怪**（常见 `skills/<name>/SKILL.md` 多一层中转目录），因此 import 需要
自己的**候选根扫描**（§4.2），**不能直接套用 git 安装的三条发现规则**——后者必须与官方 provider
一致，是硬约束，不能放宽。

## 2. 四条通道总览

| # | 通道 | 身份来源 | 可更新 | 典型场景 |
|---|---|---|---|---|
| A | git 源（`add`，已有） | `url + ref + commit` | ✅ | 公开/私有仓库，任意 git 托管平台 |
| B | 本地接管（`import <dir>`） | 探测所得 url，或空 | 探测到 → ✅；否则冻结 | 别的 agent 目录里已有技能、旧机器迁入 |
| C | 包搬运（`export` / `import <pkg>`） | 包内元数据 | 元数据含 url 且可达 → ✅；否则冻结 | 跨机器、离线交付、release 资产 |
| D | 补正身份（`adopt --url`） | 用户显式给出 | 动作完成后 ✅ | 冻结条目后来找到了它的仓库 |

**两条贯穿全设计的不变量**：

- **可更新的唯一判据是"有 git 源"**：条目记录了 `gitUrl`（且 `ref` 非空）才可 `update` / `switch-version`。
  当前代码里这条判据**还没有独立函数**，而是散在三处的 `entry.source === 'zip'`
  （`src/http/routes.ts:387`、`src/switch-version.ts:110`，以及 doctor 的两处分流）；
  本设计在实施时抽出 `hasGitSource(entry): boolean`（`gitUrl.length > 0`，落在 `src/manifest.ts`）
  作为唯一判据，并在退役阶段 3 删除 `source` 字段（见 §8）。
- **`path` 唯一**：`addEntry` 拒绝两条目共用同一目录（`src/manifest.ts:72`）。因此"一包多条目"
  目前只能是 N 份副本；P2 共享克隆落地后才可能降为"1 份目录 + N 个 `subdir`"。

### 2.1 条目的三种存储形态（决定 `remove` 的处置）

| 形态 | 目录归谁 | 可更新 | `remove` 的处置 | 判据 |
|---|---|---|---|---|
| (a) git 克隆 | nexus（`repos/<path>`） | ✅ | 删链接 + 删克隆 + 反注册 | `gitUrl` 非空 |
| (b) 快照副本 | nexus（`repos/<path>`） | ❌ | 同上 | `gitUrl` 为空 |
| (c) 外部目录（`--link-only`） | **用户自己的** | ❌ | **只删链接与注册，绝不删目录** | 需要显式标记 |

(a)(b) 的区别已经由 `gitUrl` 回答，所以**不引入三值 `source` 枚举**——那等于把"可更新性"表达两遍，
还会在下次出现新来源时继续加枚举值。只有 (c) 需要新增一个显式标记，建议
`ownership?: 'managed' | 'external'`（缺省 = `managed`）：

- `remove`：`external` 条目删链接与注册后**不调用** `removeSkillDir`；
- `doctor`：不计入 `git-sanity` 的 N/M clone 计数（沿用今天对无 git 源条目的跳过），
  `missing-target` 的修复提示给"重新接管 / 移除"而非 `update`；
- `update` / `switch-version`：按"无 git 源"拒绝（`400 not-a-git-clone`）；
- `list`：额外暴露外部目标路径，让用户看清自己纳管的是哪个目录；
- manifest 形状：`external` 条目仍写 `path`（类型要求，也用于去重），但该目录**不由 nexus 创建、
  也不由 nexus 删除**；`gitUrl` / `ref` / `commit` 为空。

**硬不变量：`external ⇒ gitUrl === ''`（`ref` / `commit` 同样为空）。** 于是 `hasGitSource` 对它恒为
false → `update` / `switch-version` 必然拒绝 → **nexus 永远不会对用户的目录执行 git 操作**。
因此 `--link-only` **只允许在 B3（完全无线索）使用**：B1/B2 已经探测到远程时再用它，只会得到一个
"指向用户目录、又没有远程身份"的四不像，故直接拒绝该组合，并提示两条正路（默认克隆进 `repos/`，
或 `--copy` 落快照）。

## 3. 通道 B：本地接管（判定阶梯）

接受一个本地技能目录（或一组候选根），按**线索强度**逐级降级：

| 级别 | 线索 | 动作 | 结果 |
|---|---|---|---|
| **B1** | 目录自身是 git 克隆（有 `.git`，`remote.origin.url` 可读） | 以该 remote 重新克隆登记（可带 `--ref` / `--subdir`） | ✅ 可更新（最佳） |
| **B2** | 无 `.git`，但 frontmatter、`nexus-package.json` 或其它管理器的清单里有 url | 同上 | ✅ 可更新 |
| **B3** | 完全无线索 | 二选一：`--copy`（复制进来，冻结）或 `--link-only`（只建链接纳管、不搬迁） | 冻结 / 只读纳管 |

规则：

- **默认不搬迁**：不带 `--copy` / `--link-only` 时先做 `--dry-run`，报出判定级别与将要执行的动作；
  "我只想看一眼"不应该变成搬家。
- B1/B2 的新克隆落在 nexus 自己的 `repos/`，**原目录不动**；成功后提示用户可自行删除原目录。
- B3 的 `--link-only` 条目 `gitUrl` 为空 → 走"无 git 源条目"路径（见 §2 不变量），
  并按 §2.1 的形态 (c) 标记 `ownership: 'external'`（`remove` 只删链接、不删目录）。
  **`--link-only` 仅限 B3**：B1/B2 传入该 flag 直接拒绝（理由见 §2.1 的硬不变量）。
- 拒绝条件：同名条目已存在、官方技能根有同名真实目录（collision）、目标不可读、路径穿越。

## 4. 通道 C：包搬运（导出 / 导入）

### 4.1 `dsh-skills-nexus export <name>... | --all [-o <file>]`

产出一个包（zip 容器或目录），结构：

```
nexus-package.json          # 元数据（§5）
skills/<name>/…             # 每个技能一条完整文件树
```

导出内容 = 条目技能根（`subdir` 之后的部分）的原文。**包内一律不含 `.git`、不含任何凭据。**

| 参数 | 作用 |
|---|---|
| `<name>...` / `--all` | `--all` 导出**全部条目（含禁用条目）**——整机迁移用（场景 M） |
| `-o <file>` | 输出路径；默认 `<name>.zip`（`--all` 时为 `nexus-export-<date>.zip`） |

**`ownership: 'external'` 条目恒定跳过**（它指向用户自己的目录，nexus 连读带搬都不该做），
跳过项记入 `nexus-package.json` 的 `skipped[]`（§5），导入侧据此提示用户手工处理。

**v1 不做 `--with-git`（连 `.git` 一起打包）**，理由有两条：

1. 它想解决的问题（新机连不上仓库）本来就有出口——标签里带着 `url`，联网后 `adopt --url` 就能转正，
   而且转正后的条目与"原本就 `add` 装出来"的完全同质；
2. nexus 的克隆**全是浅克隆**（`git.ts:391/409` 的 `--depth 1`，稀疏路径再加 `--filter=blob:none`），
   所以"带 `.git` 就能离线切版本"本来也不成立：`switch-version` 在浅克隆上靠**内部 fetch** 工作
   （`src/switch-version.ts:121`、`fetchRepo` 按 ref 拉 `--depth 1`），断网照样切不了。
   打进去的只能是一份"与 `add` 产物相同的浅克隆"，价值仅剩"省掉一次联网"——不值得多一个档位与
   一套凭据清洗规则。若将来确有离线搬运需求，作为 v2 可选优化再评估，届时要写清的正是上面这条性质。

### 4.2 `dsh-skills-nexus import <file|dir> [--dry-run] [--no-net-check] [--name] [--subdir] [--each] [--force] [--no-remote]`

1. 读 `nexus-package.json`；缺失 → 视为**裸包**（按 B3 处理，并提示"来源未知"）。
2. **候选根扫描：逐层剥壳（peel），复用 locator 而不改写它。**

   术语先对齐：**候选根 = 条目的技能根**（等价于 git 侧的 `--subdir` 值）；候选根内部的每个技能，
   其**链接目标是它自己的目录**（`resourceBase`）。二者不是一回事。

   ```
   root = 解压根; peel = 0
   loop:
     skills = locateSkillFiles(root)        ← 直接复用既有三条规则，不改写
     if skills 非空: 候选根 = root; 技能 = skills; break
     if root 恰有 1 个子目录 且 peel < 3: root = 该子目录; peel++; continue
     break                                   → 无候选
   ```

   | 包内形态 | 剥壳次数 | 今天（locator 三条规则） | 目标 |
   |---|---|---|---|
   | `SKILL.md` | 0 | ✅ | ✅ 候选根 = 解压根 |
   | `alpha/SKILL.md`（+ `beta/SKILL.md`） | 0 | ✅ | ✅ 候选根 = 解压根，2 个技能 |
   | `skills/alpha/SKILL.md` | 1 | ❌ 0 技能 → 拒绝 | ✅ 候选根 = `skills/`，内部技能 = `alpha` |
   | `export-2026/skills/alpha/SKILL.md` | 2 | ❌ | ✅ 候选根 = `export-2026/skills/`；`--dry-run` 报出剥壳偏移 |
   | 只有 `notes.md`（无 `SKILL.md`） | — | ❌ | ❌，但错误分级明确（见下） |

   上限：剥壳 ≤3 层（最深命中 4 层）、候选根数与技能命中数各有上限；触顶且更深处确有 `SKILL.md` 时
   报 `skill-nested-too-deep`（附实际深度与位置）。

3. **错误分级**（今天两种情况共用一条消息，用户会误判"我的包不是技能包"）：
   - `no-skill-found`：扫描范围内没有任何 `SKILL.md` → "这不是技能包"；
   - `skill-nested-too-deep`：找到了但超出允许深度 → 报出**位置与深度**，并提示用 `--subdir` 指定。
4. 逐条目判定：**url 可达 → 走通道 A 重新克隆登记**（可更新）；不可达/缺失 → 落成快照
   （无 git 源条目），提示稍后可用 `adopt --url` 转正；`--no-remote` 强制落快照（即使标签里有 url）。
5. **状态还原**：标签里的 `enabled` 与链接名 → 导入后**原样还原**（原机禁用的技能不得自动启用）。
6. 多技能包的范围选择（与 git 的 `--subdir` 对称）：

   | 形式 | 语义 | 条目数 |
   |---|---|---|
   | 默认 | 整包一个条目（多技能 → 多链接，命名沿用既有规则） | 1 |
   | `--subdir <p>` | 只装一个根 | 1（独立条目） |
   | `--each` | 每个根一个条目 | N（**N 份副本**，代价明说；P2 后可优化） |

7. `--dry-run` 输出（**格式属契约，见 §10**）：候选根清单 + 每个条目的预期处置（四态，见 §10.2）。
   可达性检测**默认 5 秒超时**：超时记为 `(url check timed out)` 而**不是** `unreachable`
   （那是网络问题，不是仓库不存在）；离线场景用 `--no-net-check` 完全跳过检测、零等待。
8. **清单变体（自动识别，不设 flag）**：若包里只有清单（JSON 等）而无任何技能内容，import **不创建
   任何条目或链接**，只报告"该包不含技能内容"，并把清单当**线索**逐条列出可行动作——可 `add`
   （清单里有 url）/ 可 `adopt`（本机已有该目录）/ 只能落快照。是否执行由用户决定。

## 5. 包内元数据格式 `nexus-package.json`（v1）

```json
{
  "schema": "dsh-skills-nexus/package",
  "version": 1,
  "exportedAt": "2026-10-02T00:00:00Z",
  "generator": "dsh-skills-nexus 0.4.0",
  "skipped": [
    { "name": "local-notes", "reason": "external (link-only) — points at a directory on the exporting machine" }
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
          "description": "…",
          "links": ["daily-trend-writer"]
        }
      ]
    }
  ]
}
```

| 字段 | 必需 | 规则 |
|---|---|---|
| `schema` / `version` | ✅ | `version` 更大 → 拒绝并提示升级；更小 → 尽力而为 |
| `entries[].name` | ✅ | 建议条目名；导入时 `--name` 或冲突策略可覆盖 |
| `entries[].gitUrl` / `ref` / `subdir` | ❌ | **有则优先走 git 通道**；无则落快照 |
| `entries[].commit` | ❌ | 仅作参考，不用于校验（避免误报） |
| `entries[].enabled` | ❌ | 导出时的启用状态；导入时**还原**（缺省视为启用）——场景 M 的关键字段 |
| `entries[].skills[]` | ❌ | 候选技能与**链接名**；供 `--dry-run` / 面板预览、导入后一致性校验与状态还原 |
| `skipped[]` | ❌ | 导出时**跳过的条目及原因**（`external` 条目恒定跳过、目录不可读等）；导入侧据此提示用户手工处理 |
| 未知字段 | — | 忽略（向前兼容） |

**安全（导出侧）**：包内**一律不含 `.git`**（跳过即可，因此不存在凭据清洗问题）；拒绝绝对路径 /
`..` / `:` 段 / NUL / 空名（zip-slip）；条目数与总/单文件大小上限；跳过符号链接；**剥离或拒绝带凭据
的 URL**（`https://user:token@host` → 拒绝，要求用 `--url` 显式给出）。

**安全（导入侧）**：解包沿用同一套限制；**外部包一律不得携带 `.git`**（发现即拒绝该条目）。

## 6. 通道 D：`adopt` 的语义与失败回退

```
dsh-skills-nexus adopt <name> --url <git-url> [--ref <r>] [--subdir <p>] [--force] [--prune]
```

前置：该条目当前**无 git 源**；否则报错（`--force` = 换源）。

七步编排（与 `switch-version` 同构）：

1. 解析 `url/ref`，克隆到临时目录 `repos/.adopt-stage-*`；
2. 用与安装相同的发现规则解析技能根，与现有条目的技能数量/名字比对 → 不一致默认拒绝（`--force` 绕过）；
3. 备份现目录：`repos/<path>` → `repos/<path>.pre-adopt-<ts>`；
4. 临时目录就位为 `repos/<path>`；
5. 重建链接：先按归属删旧集合，再按新发现结果建（沿用 `switch-version` 第 6 步与 `src/remove.ts` 的命名规则）；
6. 更新 manifest：写入 `url/gitUrl/ref/commit/subdir`，刷新 `updatedAt`；
7. `--prune` 时删除备份，否则保留并提示备份路径。

**失败回退**（任一步失败）：恢复备份目录 → 还原旧链接集合 → manifest 不变 → 非零退出并输出原因
（best-effort 吞掉回退自身的错误，与 `rollbackSwitch` 同款）。

**边界**：不改条目名；不改链接名（除重建所需）；**不做 url 猜测**（必须显式给出）。

## 7. 与既有轨道 / 待办的衔接

- **`list --json`（缺口清单 #7）**：把它定为**机器可读输出的统一约定**（稳定字段 + `schema`/`version`）。
  三处复用同一 schema 子集：`list --json`、`import --dry-run --json`（候选根数组）、面板预览。
  实现顺序上先落 `list --json`，导入预览沿用同一 shape。
- **P2 共享克隆（缺口 #5，触发条件 = 用户反馈）**：`--each` 现在必须 N 份副本（`path` 唯一）。
  P2 落地后共享"同来源的克隆/解压目录"，判定键从 `path` 升级为 `(来源身份, subdir)`。
  **因此新命令语义只依赖 `subdir` 表达偏移，不把"一份目录 = 一个条目"写死。**
- **`doctor`**：无 git 源条目需要明确归类（不可 `update`，只能 `remove` / `adopt`）；
  沿用既有 orphan-link 三码（`dangling-link` / `orphan-link` / `unreadable-link`）。
- **`remove` / `update`**：沿用已统一的 `src/remove.ts` 共享核心与 §2 的单一判据
  （实施后为 `hasGitSource`）——无 git 源条目：`list / toggle / remove` 可用；
  `update / switch-version` 明确拒绝（`400 not-a-git-clone`）；`ownership: 'external'` 的条目
  在 `remove` 时只删链接与注册，不删目录（§2.1）。

## 8. zip 的退役路径（落地顺序）

| 阶段 | 内容 | 用户可见变化 |
|---|---|---|
| 1 | 文档先行（本稿）；面板与 README 把 zip 从"安装"改述为「导入快照（不可更新）」 | 仅文案 |
| 2 | 抽出 `hasGitSource(entry)` 与 `ownership` 标记并把三处 `source === 'zip'` 换成前者（**纯判据替换，行为等价**）；实现 `import` / `export` / `adopt`（参数面见 §10）；zip 上传入口并入 `import` 行 | 新命令与入口；zip 语义不变 |
| 3 | 删除 `add-zip` 路由与 `src/zip.ts` 的安装编排；移除 `source` 字段；PKZip 解析器降级为包搬运的内部实现（或改用现成库） | 旧 zip 条目转为"无 git 源条目"：`list / toggle / remove` 照常，`update / switch-version` 明确拒绝 |

**升级时序与数据迁移（不需要迁移脚本）**：

- **错误码改名在阶段 2**：`zip-not-updatable` → `not-a-git-clone`，与判据替换**同一提交**——触发条件
  本身从"来源是 zip"变成了"没有 git 源"。改名是**线上契约变更**，必须同步改面板的 errorText 文案；
  阶段 3 删掉 `add-zip` 路由后不再涉及该码。
- **旧 `source: 'zip'` 条目无需任何数据迁移**：它们的 `gitUrl` / `ref` / `commit` 在安装时就是空
  （`src/zip.ts` 写入），换成 `hasGitSource` 后行为与"快照副本"（§2.1 形态 b）完全一致；
  `manifest.version` 保持 `1`（旧版代码读到新 manifest 只是多一个被忽略的未知字段）。
- **`source` 的读取点共 9 处**，阶段 2/3 的改动面就是它们：`health.ts:357`、`switch-version.ts:110`、
  `doctor.ts:163/314/382`、`routes.ts:221/387/422`、`client/panel.tsx:497`。其中
  **`routes.ts:221` 会把 `source` 放进 `list` 载荷**、面板据此显示 `zip` 徽标——这是**客户端契约**，
  阶段 3 删字段时必须同步改载荷与客户端类型。

**不做**：不做 zip → git 的自动来源猜测（必须显式 `--url`）；不做市场/网盘对接；
不为"一包多条目"引入共享目录（留给 P2）。

## 9. 验收与不变量

- 每条通道都要有：CLI 与面板行为一致；负向用例（同名冲突、不可达 url、包缺元数据、路径穿越、
  版本不匹配）；`remove` 之后 doctor 的 orphan-link 为 0。
- **场景 M（整机迁移）**：`export --all` 后在新机 `import` → 条目数、每条目的 `subdir` 与
  **启用/禁用状态**逐条一致；新机能连仓库时全部落成 git 条目（可 `update` / `switch-version`）；
  连不上时落成快照，**联网后 `adopt --url` 能把它转成 git 条目**——这就是断网搬运的验收路径
  （包不携带 `.git`，见 §4.1）。
- **场景 P（第三方移植）**：对 `skills/<name>/SKILL.md` 及带一层包装的包，`--dry-run` 报出正确候选根；
  导入后 `~/.dsh/skills/` 顶层有链接、DSH 能列出该技能、nexus `list` 能看到条目；
  无标签时提示为"来源未知"而**不是**"不是技能包"。
- 不变量：可更新 ⟺ 有 `gitUrl + ref`；`path` 唯一；导入不覆盖既有条目名；
  **`remove` 绝不删除非 nexus 所有的目录**（`ownership: 'external'` 只删链接与注册）；
  `adopt` 失败后"目录、链接、manifest"三者与操作前一致。

## 10. 命令面与契约

### 10.1 CLI 命令面

| 命令 | 作用 | 参数 | 输出 / 退出 |
|---|---|---|---|
| `add <spec>` | git 源安装（已有） | `--ref` `--subdir` `--name` `--yes` | 既有语义不变 |
| `export <name>... \| --all` | 产包（技能内容 + 标签） | `-o` | 不触网；0/1 |
| `import <file\|dir>` | 收包 | `--dry-run` `--no-net-check` `--name` `--subdir` `--each` `--force` `--no-remote` | 0/1；`--dry-run` 见 §10.2 |
| `adopt <name>` | 补身份（D 通道） | `--url`（必需）`--ref` `--subdir` `--force` `--prune` | 失败整体回滚；0/1 |

**共享核心**：`import` 与 `adopt` 必须由 CLI 与面板调用**同一实现**（形如 `src/import.ts` /
`src/adopt.ts`，对齐 `src/switch-version.ts` 与 `src/remove.ts` 的既有先例）。当前 `installFromZip`
只被 `add-zip` 路由调用、CLI 无对应命令，正是"两侧不一致"的反例——新通道不得重演。

### 10.2 `--dry-run` 输出契约

`import --dry-run` 必须打印（并支持 `--json`，与 §7 的 `list --json` 同一 schema 约定）：

```
package: claude-skills.zip
manifest: none (source unknown)
candidates:
  skills/alpha      name=alpha-skill   will import as snapshot (source unknown)
  skills/beta       name=beta-skill    will import as snapshot (source unknown)
```

判定只有一条分叉线——**包里有没有标签、标签里的 url 此刻是否可达**。四态：

| 情况 | 输出 |
|---|---|
| 有标签且 url 可达 | `will clone from <url> (<ref>)` |
| 有标签但 url 不可达 | `will import as snapshot (<url> unreachable)` |
| 有标签、检测超时（默认 5s） | `will import as snapshot (<url> check timed out)` |
| 无标签（裸包 / 第三方） | `will import as snapshot (source unknown)` |

`--no-net-check` 完全跳过可达性检测（离线场景零等待），此时一律输出 `(not checked)`，
**不得**把"未检测"写成 `unreachable`。

### 10.3 面板同构

| 命令 | 面板位置 | 备注 |
|---|---|---|
| `import` | 复用今天 `add-zip` 那一行：选文件 → `--dry-run` 预览（四态 + 候选根）→ 确认导入 | 预览必须显示"可更新 / 快照"的区别 |
| `adopt` | 条目行内动作（"attach source"） | 仅在无 git 源条目上出现，与 `update` / `switch-version` 并列 |
| `export` | 可后置（CLI 优先） | 无交互刚需 |

### 10.4 错误码（沿用既有方言）

| 场景 | CLI | HTTP |
|---|---|---|
| 无 git 源却要 `update` / `switch-version` | 明确文案 + 退出 1 | `400 not-a-git-clone` |
| 包内没有任何 `SKILL.md` | `no-skill-found` + 退出 1 | `400 no-skill-found` |
| 找到了但层级过深 | `skill-nested-too-deep`（含位置、深度与 `--subdir` 提示） | `400 skill-nested-too-deep` |
| 包无 `nexus-package.json` | 提示"来源未知（将落快照）"，**不算错误** | 同左（仍 2xx） |
| 同名冲突 | 拒绝；`--force` 可覆盖 | `409 already-registered` |

**改名时机**：`zip-not-updatable` → `not-a-git-clone` 发生在**阶段 2**（与 `hasGitSource` 判据替换同一
提交，因为触发条件本身变了），并同步更新面板 errorText；阶段 3 删除 `add-zip` 路由后该错误码不再出现。
