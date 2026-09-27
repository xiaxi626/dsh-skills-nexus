# --subdir 设计备忘（集合仓库的"挑着装"）

> 状态：设计决策记录 · 2026-08-23 · 2026-09-26 增补：独立稀疏安装（A）+ 冗余 `--name` 提示（C），见文末「增补」节
> 动机：`trae-community/trae-skills` 等集合仓库（`skills/<name>/SKILL.md` 嵌套布局）
> 无法用 `add <repo>` 直接安装：要么被当作 unknown 拒绝，要么误装仓库根目录的
> 文档文件而漏掉全部真 skill（见 CHANGELOG 的 Observed 记录）。

## 背景：条目的三重身份

当前 manifest 里一个"条目"同时承担三个身份：

- **(a) 管理单元**：`enable/disable/remove/update` 的操作对象（按条目名查找）
- **(b) 克隆单元**：一个克隆目录（`skills/<path>/`）
- **(c) skill 解析范围**：resolve 扫描的根目录

`--subdir` 的本质是**只改 (c)**：解析范围从克隆根缩到克隆内子目录，(a)(b) 不变。
这是设计保持简单的原因——命令语义与无 subdir 时完全一致。

## 两种方案

### 方案 P1：独立克隆（v1 采用）

每次 `add --subdir` 独立克隆整个仓库，条目完全独立：

```bash
# 安装（两次 add = 克隆仓库两次）
dsh-skills-nexus add github:trae-community/trae-skills --subdir skills/daily-trend-writer
dsh-skills-nexus add github:trae-community/trae-skills --subdir skills/zopia_ai_skills

# 开启 / 关闭（按条目名，条目名默认 = subdir 末段）
dsh-skills-nexus disable daily-trend-writer
dsh-skills-nexus enable  daily-trend-writer

# 卸载（只删自己的克隆和条目，互不影响）
dsh-skills-nexus remove daily-trend-writer
```

manifest 视角（两条目完全独立，path 唯一化）：

```json
{ "name": "daily-trend-writer", "path": "trae-skills-daily-trend-writer", "subdir": "skills/daily-trend-writer", "ref": "main" }
{ "name": "zopia_ai_skills",    "path": "trae-skills-zopia_ai_skills",    "subdir": "skills/zopia_ai_skills",    "ref": "main" }
```

### 方案 P2：共享克隆 + 多条目（后续候选，v1 不做）

一个克隆目录，多个条目指向同一 path、不同 subdir：

```bash
# 安装（第一次 add 克隆；第二次检测到同仓库已克隆 → 复用，只加条目）
dsh-skills-nexus add github:trae-community/trae-skills --subdir skills/daily-trend-writer
dsh-skills-nexus add github:trae-community/trae-skills --subdir skills/zopia_ai_skills

# 开启 / 关闭（命令与 P1 完全相同）
dsh-skills-nexus disable daily-trend-writer

# 卸载（引用计数：非最后一个条目只删条目，克隆保留）
dsh-skills-nexus remove daily-trend-writer   # 克隆保留（zopia 还在用）
dsh-skills-nexus remove zopia_ai_skills      # 最后一个条目 → 克隆一并删除
```

manifest 视角（两条目同 path、不同 subdir）：

```json
{ "name": "daily-trend-writer", "path": "trae-skills", "subdir": "skills/daily-trend-writer", "ref": "main" }
{ "name": "zopia_ai_skills",    "path": "trae-skills", "subdir": "skills/zopia_ai_skills",    "ref": "main" }
```

## 差异对比

| 维度 | P1 独立克隆 | P2 共享克隆 |
|---|---|---|
| 克隆数 / 磁盘 | N 个 skill = N 份克隆（现为稀疏检出，见增补） | 永远 1 份 |
| 第二次 `add` | 重新 clone（filtered + 稀疏检出，减少无关内容） | 检测复用，几乎瞬时 |
| `remove` 一个 | 删自己的克隆，零连坐 | 需要引用计数（非最后一个只删条目） |
| `update`（全部） | 每个条目各自 pull（同仓库拉 N 次） | 按 path 去重，pull 1 次，多条一起盖章 |
| ref/commit 锁 | 每个条目独立锁 | 共享同一把锁 |
| 命令语义 | 与现状完全一致（条目即管理主体） | 一致，但 remove 行为多分支 |
| 实现复杂度 | 现状模型 + `subdir` 字段 + path 拼接 | 新增 add 复用检测、同 path 多条目、引用计数、update 去重 |

## 两个隐藏坑（P2 必须先解决才能做）

1. **共享判定键**：第二次 add 怎么判定"同一个仓库"？不能只看 URL——`#main` 与 `#v1.0.0`
   pin 的两次安装 clone 内容不同，不能共享。判定键至少是 `gitUrl + ref`
   （可能还要 commit），否则共享目录会互相踩。
2. **锁的归属**：共享克隆下锁（ref/commit）是目录级的，一个条目 `update` 或改 ref，
   另一个条目跟着变——条目语义从"独立安装"退化成"同一安装的两个视图"，
   破坏用户心智模型。

## v1 决策

- 采用 **P1 独立克隆**：命令语义与现状零差异，实现增量小，无引用计数/共享判定新概念。
- 代价（重复克隆的磁盘/时间）写入 README 注意事项。
- **触发 P2 评估的条件**：真实用户反馈"同一大集合装了多个 skill 太占磁盘/克隆太慢"，
  且此时需求场景与 ref 共享规则已清晰。

## 相关设计点（同一迭代）

- `name` 默认取 subdir 末段（`--name` 可覆盖）；`path` = `repoSlug-subdir末段` 唯一化。
- 防呆（C）：add 注册前做"解析预览"——
  - 预览 = 0 → 拒绝，提示嵌套子目录可用 `--subdir`（修掉"假装安装"闭环）；
  - 预览 > 20 且未指定 `--subdir` → 确认提示（`--yes` 跳过，非 TTY 默认拒绝）。
- 撞名不消歧（与 `dsh plugin` 生态一致）：同名 skill 后注册者覆盖，文档注明。
- 全量装的集合只能整组开关（条目级 enable/disable）；想单独控制用 `--subdir` 挑着装。
- 平铺扫描保守化（A1/A2）：跳过 `readme*`/`contributing*`/`changelog*`/`license*`/
  `code-of-conduct*`/`security*`；平铺 md 无 frontmatter（name 且 description 均无）不再成为 skill。

## 增补（2026-09-26）：独立稀疏安装（A）+ 冗余 --name 提示（C）

v1 之上的两项追加改动，不改变条目语义与命令接口：

### A：`--subdir` 改走稀疏检出

- `cloneRepo()` 增加可选第三参 `{ subdir }`；有 `subdir` 时改用
  **partial clone + cone 模式 sparse-checkout**：
  `clone --depth 1 --filter=blob:none --no-checkout` →
  `sparse-checkout set --cone -- <subdir>`（在首次显式 checkout 前建立规则）→
  `checkout <ref>`。返回实际工作树模式（`full`/`sparse`）与警告，供 CLI 展示。
- 检出范围 = 目标目录完整子树 + cone 规则保留的仓库根及各祖先目录直属文件；
  无关 skill 目录不检出；根插件标记（`cordis.patch.yml` 等）仍可读，分类行为不变。
- 兼容降级按**命令能力**探测（不按版本号）：顶层 `git sparse-checkout -h` 判命令
  存在性，克隆内 `set -h` 判 `--cone`/`--skip-checks`。明确缺能力 → 复用本次
  未检出的克隆补成整仓浅检出并警告（不重复下载）；远端忽略 filter → 仍稀疏检出
  并警告「可能已下载整仓对象」；网络/认证/ref/磁盘失败 → 按原失败语义处理，
  不转整仓回退。
- 退出稀疏（手动、单向）：`git -C <克隆目录> sparse-checkout disable`——
  获取并检出剩余全部内容；后续 `update` 不会重新强制稀疏。旧整仓克隆不自动迁移。

### C：冗余 `--name` 提示

- `--subdir` 安装成功、且显式 `--name` 经 `sanitizeName` 归一后等于默认条目名
  （subdir 末段）时，追加一次提示 `提示：--name 与默认条目名 "x" 相同，可省略。`；
  未传 `--name`、名称不同、失败或中止均为 0 次。只加提示，不改命名规则与机器接口。
