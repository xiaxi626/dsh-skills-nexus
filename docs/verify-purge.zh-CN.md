# 验证 `purge` 清理命令

本指南验证 **`purge`** 命令——默认 dry-run 的产物扫描与清理工具，覆盖四类积累产物：

- **`exports/*.zip`** —— 每次 `export` 都生成新归档，旧归档从不自动回收。
- **`manifest.json.corrupt-*`** —— 原子写入遇到损坏 manifest 时留下的备份；每次损坏事件留一个。
- **`upload-*`** —— 包导入期间的临时目录；`mkdir` 和 `rm` 之间崩溃会留下孤儿。
- **`rollback/<name>.json`** —— 已删除 skill 的恢复点。**活跃** skill 的回滚文件**绝不**被碰。

默认模式是 **dry-run**：只扫描和报告，不删除。传 `--yes` 实际删除。`--json` 输出机器可读报告（`version: 1`）。

**24 小时 mtime 保护窗口**会跳过最近修改过的产物——但 `corrupt-manifest` 备份例外，它们无条件可删（活跃 manifest 已切换到空回退）。

> **Shell 警告——Windows 用户：在 Git Bash（MINGW64）中跑下面的流程，**
> **不要用 PowerShell。** 以下所有命令块都是 POSIX / Bash 语法。命令使用
> 绝对路径，不会 `cd` 进你的项目仓库，工作树不会被污染。

以下操作都是安全的：使用隔离的临时 `DSH_HOME`，本地 `file://` 远端代替
GitHub（无网络），不碰你真实的 `~/.dsh`。最后统一删除临时目录。

## 前置条件

- Node.js ≥ 20，且 `git` 在 `PATH` 中
- 已 checkout 仓库并执行过 `npm install`
- 如果改过 `src/`，先 `npm run build`——下面跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
```

| 测试文件 | 验证内容 |
|---|---|
| `test/purge.test.ts` | 4 类产物扫描；mtime 保护跳过近期项；corrupt-manifest 豁免 mtime 保护；`executePurge` 记录失败；CLI dry-run / `--yes` / `--json` 输出；活跃 skill 回滚文件不被碰 |
| `test/remove.test.ts` | `remove` 清理被删 skill 的孤立回滚 JSON |

---

## 第二部分 — 端到端验证

每个平台一个可整体复制的命令块。把 `PROJECT` 换成你的仓库路径。

### Linux / macOS

```bash
# ---- 隔离的 DSH_HOME ----
export DSH_HOME=/tmp/nexus-purge
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{exports,rollback}
PROJECT=~/dsh-skills-nexus                              # ← 改成你的路径
cd "$PROJECT"

# ---- A) 在 4 个类别中播种产物 ----
# 1. export 归档
echo "fake-zip-content" > "$DSH_HOME/skills-nexus/exports/backup-2026-10-01.zip"
# 2. corrupt-manifest 备份
echo "corrupt-data" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-2026-10-05T120000"
# 3. upload-temp 目录（设旧 mtime > 24h 前）
mkdir -p "$DSH_HOME/skills-nexus/upload-abc123"
echo "temp-data" > "$DSH_HOME/skills-nexus/upload-abc123/package.json"
touch -t 202601010000 "$DSH_HOME/skills-nexus/upload-abc123"         # 旧 mtime
# 4. 孤立回滚文件（manifest 中无对应 skill）
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/removed-skill.json"

# ---- B) dry-run（默认）----
node lib/cli/index.js purge
# 期望：列出 4 个产物及类别、大小，末尾 "Dry run — pass --yes to delete."

# ---- C) --json dry-run ----
node lib/cli/index.js purge --json
# 期望：JSON 报告 "version":1, "removed":0, "failed":[], "files" 含 4 条

# ---- D) 实际删除 ----
node lib/cli/index.js purge --yes
# 期望："Purged 4 artifact(s) (...)."

# ---- E) 验证清理 ----
ls "$DSH_HOME/skills-nexus/exports/"              # → 空
ls "$DSH_HOME"/manifest.json.corrupt-*  # → 无匹配
ls "$DSH_HOME"/upload-*              # → 无匹配
ls "$DSH_HOME/skills-nexus/rollback/"             # → 空

# ---- F) "Nothing to purge" ----
node lib/cli/index.js purge
# 期望："Nothing to purge."

# ---- 清理 ----
rm -rf "$DSH_HOME"
unset DSH_HOME
```

### Windows（Git Bash / MINGW64）

```bash
# ---- 隔离的 DSH_HOME ----
export DSH_HOME="$(cygpath -m "$TEMP/nexus-purge")"
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{exports,rollback}
PROJECT=~/Downloads/dsh-skills-nexus                    # ← 改成你的路径
cd "$PROJECT"

# ---- A) 播种产物 ----
echo "fake-zip-content" > "$DSH_HOME/skills-nexus/exports/backup.zip"
echo "corrupt-data" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-2026-10-05T120000"
mkdir -p "$DSH_HOME/skills-nexus/upload-abc123"
echo "temp-data" > "$DSH_HOME/skills-nexus/upload-abc123/package.json"
# Windows 回退 mtime > 24h：通过 PowerShell
powershell -Command "(Get-Item '$DSH_HOME/skills-nexus/upload-abc123').LastWriteTime = (Get-Date).AddDays(-2)"
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/removed-skill.json"

# ---- B) dry-run ----
node lib/cli/index.js purge
# 期望：列出 4 个产物，"Dry run — pass --yes to delete."

# ---- C) --json dry-run ----
node lib/cli/index.js purge --json

# ---- D) 实际删除 ----
node lib/cli/index.js purge --yes
# 期望："Purged 4 artifact(s) (...)."

# ---- E) 验证 ----
ls "$DSH_HOME/skills-nexus/exports/"              # → 空
ls "$DSH_HOME/skills-nexus/rollback/"             # → 空

# ---- F) "Nothing to purge" ----
node lib/cli/index.js purge           # → "Nothing to purge."

# ---- 清理 ----
rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## 第三部分 — mtime 保护窗口

最近 24 小时内修改过的产物被跳过——但 `corrupt-manifest` 备份例外。

### Linux / macOS

```bash
export DSH_HOME=/tmp/nexus-purge-mtime
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

# 一个“新”的 upload-temp（mtime = 现在，在 24h 窗口内）
mkdir -p "$DSH_HOME/skills-nexus/upload-recent"
echo "fresh" > "$DSH_HOME/skills-nexus/upload-recent/data.bin"
# mtime 是现在——在保护窗口内

node lib/cli/index.js purge --yes
# 期望：upload-recent 目录未被删除（mtime 保护）。
ls "$DSH_HOME/skills-nexus/upload-recent/"        # → 仍在

# 一个"新"的 corrupt-manifest 备份（mtime = 现在）
echo "broken" > "$DSH_HOME/skills-nexus/manifest.json.corrupt-fresh"
# corrupt-manifest 豁免 mtime 保护

node lib/cli/index.js purge --yes
# 期望：corrupt-manifest 即使很新也被删除。
ls "$DSH_HOME"/manifest.json.corrupt-*  # → 无匹配

rm -rf "$DSH_HOME"
unset DSH_HOME
```

### Windows（Git Bash）

命令与上面相同，只需替换路径写法：

```bash
export DSH_HOME="$(cygpath -m "$TEMP/nexus-purge-mtime")"
# ... 与上面相同 ...
rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## 第四部分 — 活跃 skill 的回滚文件不被清理

```bash
export DSH_HOME=/tmp/nexus-purge-active
rm -rf "$DSH_HOME"
mkdir -p "$DSH_HOME/skills-nexus"/{rollback,repos}
PROJECT=~/dsh-skills-nexus
cd "$PROJECT"

# 创建一个含一条 skill 的最小 manifest
cat > "$DSH_HOME/skills-nexus/manifest.json" <<'EOF'
{"version":1,"skills":[{"name":"my-skill","path":"my-skill","url":"github:test/repo","gitUrl":"github:test/repo","ref":"main","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","links":[]}]}
EOF

# 活跃 skill 的回滚文件——绝不能被清理
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/my-skill.json"
# 已删 skill 的回滚文件——应该被清理
echo '{"version":1}' > "$DSH_HOME/skills-nexus/rollback/gone-skill.json"

node lib/cli/index.js purge
# 期望：只出现 "orphan-rollback: .../rollback/gone-skill.json"。
# my-skill.json 不出现（活跃 skill）。

node lib/cli/index.js purge --yes
# 期望：只删了 gone-skill.json；my-skill.json 幸存。
ls "$DSH_HOME/skills-nexus/rollback/"
# → my-skill.json 仍在

rm -rf "$DSH_HOME"
unset DSH_HOME
```

---

## 每一步应该输出什么

| 步骤 | 期望输出 | 含义 |
|------|----------|------|
| B：dry-run | `Found N artifact(s) (...):` + 列表 + `Dry run — pass --yes to delete.` | 只扫描，未删除 |
| C：`--json` dry-run | `{"version":1,"files":[...],"totalSize":N,"removed":0,"failed":[]}` | 机器可读预览 |
| D：`--yes` | `Purged N artifact(s) (...).` | 实际已删除 |
| E：验证 | 目录为空 | 产物已清除 |
| F：空 | `Nothing to purge.` | 无产物 |
| mtime：新 upload | 未删除 | 24h 保护生效 |
| mtime：新 corrupt | 已删除 | corrupt-manifest 豁免保护 |
| 活跃回滚 | `my-skill.json` 幸存 | 活跃 skill 受保护 |
| 孤立回滚 | `gone-skill.json` 已删 | 已删 skill 被清理 |

---

## 实践中踩过的坑

1. **`touch -t` 格式因平台而异** —— Linux 接受 `touch -t 202601010000`；
   macOS 可能需要 `touch -t 202601010000.00`。Windows Git Bash 用
   PowerShell 回退时间：`powershell -Command "(Get-Item '...').LastWriteTime = (Get-Date).AddDays(-2)"`。
2. **`mkdir -p` 花括号展开** —— Bash 下有效；如果你的 shell 不支持
   `{exports,rollback}`，逐个创建目录。
3. **`DSH_HOME` 路径格式** —— CLI 原样读取 `DSH_HOME`。Windows Git Bash
   用 `cygpath -m` 转成 Node 进程能解析的 Windows 风格路径。
4. **跑的是编译产物** —— 流程使用 `lib/`；改过 `src/` 后先
   `npm run build` 再验证。
5. **purge 不可逆** —— `--yes` 实际删除。默认 dry-run 是刻意设计；
   传 `--yes` 前务必先检查 dry-run 输出。
6. **活跃 skill 回滚文件** —— `purge` 检查 manifest 的 skill 列表。
   名字匹配活跃条目的回滚文件无论新旧都保留。

---

## 覆盖边界

本指南刻意不覆盖的内容：

- **Windows 故障注入** —— 模拟 `rm` 失败（如文件锁）需要在 purge 运行
  时对文件持排他锁。自动化测试（`test/purge.test.ts`）用 `fs.open` 文件
  锁覆盖了这条路径；手动复现因平台而异且脆弱。
- **真实 GitHub 网络** —— 无需网络；所有产物都在本地。
- **DSH 运行时集成** —— purge 是纯文件系统操作；不与 DSH 插件或面板交互。
- **Node 20 / 22 / 24 矩阵** —— CI（`.github/workflows/ci.yml`）在 push/PR
  时跑完整质量门禁。
