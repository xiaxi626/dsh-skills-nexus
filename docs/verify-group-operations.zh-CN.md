# 验证组操作（toggle --group / remove --group）

本指南验证按 `groupPath` 前缀批量启用、禁用或删除条目的**组操作**——[sources-and-packages.zh-CN.md](sources-and-packages.zh-CN.md) 中的通道 E：

- **`enable --group <path>`** / **`disable --group <path>`** — 切换 `groupPath` 逐段匹配该前缀的每个条目。
- **`remove --group <path>`** — 删除每个匹配的条目（symlink + manifest 记录；外部目录保留）。

两个命令共享同一条**段级精确**匹配规则：前缀按 `/` 拆分后逐段比较。如果用字符串 `startsWith`，`trae-cn/skill`（少了末尾的 `s`）会误匹配所有 `trae-cn/skills/*` 条目；段级精确规则避免了这个问题。

以下操作均安全：不会触碰你的真实 `~/.dsh` 或 `~/.trae-cn`，不联系任何网络，所有临时状态位于专用临时目录中，最后删除。

## 前置条件

- Node.js >= 18，git 在 `PATH` 中
- 仓库已检出并执行过 `npm install`
- 如果修改了 `src/`，先执行 `npm run build`——演练使用 `lib/` 中的编译后 CLI

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck     # tsc --noEmit（严格 + noUncheckedIndexedAccess）
npm run lint          # ESLint 9 + typescript-eslint
npm test              # node:test + tsx——预期：全部通过
npm run build         # tsc -> lib/
```

相关测试覆盖：

| 测试文件 | 验证内容 |
|---|---|
| `test/toggle-group.test.ts` | 段级精确前缀匹配；子组隔离（`trae-cn/skills` 不触碰直接写入的第二子组）；空组报错（人类/JSON）；名字交集（`--group <path> <name>`）；已在目标状态时的幂等性；managed 条目（无 `groupPath`）对 `--group` 不可见 |
| `test/remove-group.test.ts` | 批量删除并保留外部目录；段边界；与名字 pattern 互斥（exit 2）；空组（人类 exit 1，JSON exit 1 且 `summary.failed: 1`）；非 TTY 拒绝（exit 2）；交互确认 + 中止；`--yes` 跳过确认；单匹配免确认 |
| `test/api.test.ts` | HTTP toggle 路由段级精确匹配（`trae-cn/skill` → 404，`trae-cn/skills` → 200）；name+group 互斥（400） |
| `test/args.test.ts` | `parseRemoveArgs --group`：分隔值、内联 `--group=`、空值报错 |
| `test/completions.test.ts` | 四个模板的 `remove` 分支均提供 `--group` |

---

## 第二部分 — 端到端演练

每个平台一个完整可粘贴的代码块。将 `PROJECT` 替换为你的检出路径。

演练环境创建一个假的 trae-cn 目录，包含跨两个子组的 6 个技能：4 个位于 `skills/`（用 `link trae-cn --trae-cn-dir` 注册），2 个位于 `vendor_skills/`（手工写入——manifest 条目 + 符号链接：link 通道只扫描 `skills/`，第二子组已无法经 `link` 到达）——不触碰真实的 `~/.trae-cn`。

### Windows（Git Bash / MINGW64）

```bash
PROJECT=~/Downloads/dsh-skills-nexus                  # <- 你的路径
TROOT="$(cygpath -m "$TEMP")/nexus-group-ops"
rm -rf "$TROOT"
mkdir -p "$TROOT"

# ---- 假 trae-cn 目录：4 个 skills + 2 个 vendor_skills ----
TRAECN="$TROOT/trae-cn"
for d in skills/alpha skills/beta skills/gamma skills/delta \
         vendor_skills/review vendor_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] 链接假 trae-cn 目录 ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
# link 只扫描 skills/ —— 2 个 vendor_skills 条目手工写入。
# 照抄 linkLocal 的两步（manifest 条目 + 符号链接）：只写 manifest 的条目
# 没有链接，`list` 会显示 off，步骤 [b] 的「4 off / 2 on」判别就失效。
TRAECN="$TRAECN" node --input-type=module <<'EOF'
import('./lib/manifest.js').then(async (m) => {
  const { join } = await import('node:path');
  const link = await import('./lib/link.js');
  const trae = process.env.TRAECN;
  for (const s of ['review', 'debug']) {
    const dir = join(trae, 'vendor_skills', s);
    const name = `trae-cn.vendor_skills.${s}`;
    await m.addEntry({
      name,
      url: `trae-cn:vendor_skills/${s}`,
      gitUrl: '', ref: '',
      ownership: 'external', path: dir,
      addedAt: new Date().toISOString(),
      externalDir: dir,
      groupPath: ['trae-cn', 'vendor_skills', s],
    });
    await link.linkSkill(name, dir);
  }
});
EOF
node lib/cli/index.js list --names
# 预期：6 个名字，全部 on

echo "--- [b] 禁用 skills 子组 ---"
node lib/cli/index.js disable --group trae-cn/skills
node lib/cli/index.js list
# 预期：4 个 skills/* 条目 off；2 个 vendor_skills/* 条目仍 on

echo "--- [c] 重新启用 skills 子组 ---"
node lib/cli/index.js enable --group trae-cn/skills
node lib/cli/index.js list
# 预期：全部 6 个恢复 on

echo "--- [d] 段边界：'trae-cn/skill' 不得匹配 'trae-cn/skills/*' ---"
node lib/cli/index.js disable --group trae-cn/skill; echo "exit=$?"
# 预期：exit=1，"no entries match group"
node lib/cli/index.js list
# 预期：全部 6 个仍 on（无任何条目被切换）

echo "--- [e] 删除 skills 子组（--yes 跳过确认） ---"
node lib/cli/index.js remove --group trae-cn/skills --yes
node lib/cli/index.js list --names
# 预期：仅剩 trae-cn.vendor_skills.review 和 trae-cn.vendor_skills.debug

echo "--- [f] 外部目录在删除后保留 ---"
ls "$TRAECN/skills/alpha/SKILL.md" 2>/dev/null && echo "user dir preserved" || echo "USER DIR LOST"
# 预期："user dir preserved"——remove 不删除用户的源目录

echo "--- [g] 用 L1 组删除剩余条目 ---"
node lib/cli/index.js remove --group trae-cn --yes
node lib/cli/index.js list --names
# 预期：空（无条目）

echo "--- [h] 空组是错误，不是空成功 ---"
node lib/cli/index.js remove --group trae-cn --yes; echo "exit=$?"
# 预期：exit=1，"no entries match group"

echo "--- [i] 互斥：--group + 名字 → usage error ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN" >/dev/null
node lib/cli/index.js remove --group trae-cn alpha; echo "exit=$?"
# 预期：exit=2，"--group cannot be combined with name patterns"

echo "--- [j] 清理 ---"
rm -rf "$TROOT"
unset DSH_HOME
```

### Linux / macOS

同样的命令，使用普通绝对路径（不需要 `cygpath`）：

```bash
PROJECT=~/dsh-skills-nexus                            # <- 你的路径
TROOT=/tmp/nexus-group-ops
rm -rf "$TROOT"
mkdir -p "$TROOT"

TRAECN="$TROOT/trae-cn"
for d in skills/alpha skills/beta skills/gamma skills/delta \
         vendor_skills/review vendor_skills/debug; do
  name=$(echo "$d" | tr '/' '.')
  mkdir -p "$TRAECN/$d"
  printf -- "---\nname: trae-cn.%s\ndescription: %s\n---\nBody\n" \
    "$name" "$name" > "$TRAECN/$d/SKILL.md"
done

export DSH_HOME="$TROOT/home"
cd "$PROJECT"

echo "--- [a] 链接假 trae-cn 目录 ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN"
# link 只扫描 skills/ —— 2 个 vendor_skills 条目手工写入。
# 照抄 linkLocal 的两步（manifest 条目 + 符号链接）：只写 manifest 的条目
# 没有链接，`list` 会显示 off，步骤 [b] 的「4 off / 2 on」判别就失效。
TRAECN="$TRAECN" node --input-type=module <<'EOF'
import('./lib/manifest.js').then(async (m) => {
  const { join } = await import('node:path');
  const link = await import('./lib/link.js');
  const trae = process.env.TRAECN;
  for (const s of ['review', 'debug']) {
    const dir = join(trae, 'vendor_skills', s);
    const name = `trae-cn.vendor_skills.${s}`;
    await m.addEntry({
      name,
      url: `trae-cn:vendor_skills/${s}`,
      gitUrl: '', ref: '',
      ownership: 'external', path: dir,
      addedAt: new Date().toISOString(),
      externalDir: dir,
      groupPath: ['trae-cn', 'vendor_skills', s],
    });
    await link.linkSkill(name, dir);
  }
});
EOF
node lib/cli/index.js list --names

echo "--- [b] 禁用 skills 子组 ---"
node lib/cli/index.js disable --group trae-cn/skills
node lib/cli/index.js list

echo "--- [c] 重新启用 skills 子组 ---"
node lib/cli/index.js enable --group trae-cn/skills
node lib/cli/index.js list

echo "--- [d] 段边界：'trae-cn/skill' 不得匹配 'trae-cn/skills/*' ---"
node lib/cli/index.js disable --group trae-cn/skill; echo "exit=$?"
node lib/cli/index.js list

echo "--- [e] 删除 skills 子组 ---"
node lib/cli/index.js remove --group trae-cn/skills --yes
node lib/cli/index.js list --names

echo "--- [f] 外部目录在删除后保留 ---"
ls "$TRAECN/skills/alpha/SKILL.md" 2>/dev/null && echo "user dir preserved" || echo "USER DIR LOST"

echo "--- [g] 用 L1 组删除剩余条目 ---"
node lib/cli/index.js remove --group trae-cn --yes
node lib/cli/index.js list --names

echo "--- [h] 空组是错误 ---"
node lib/cli/index.js remove --group trae-cn --yes; echo "exit=$?"

echo "--- [i] 互斥：--group + 名字 → usage error ---"
node lib/cli/index.js link trae-cn --trae-cn-dir "$TRAECN" >/dev/null
node lib/cli/index.js remove --group trae-cn alpha; echo "exit=$?"

echo "--- [j] 清理 ---"
rm -rf "$TROOT"
unset DSH_HOME
```

---

## 各步骤预期输出

| 步骤 | 预期输出 | 含义 |
|---|---|---|
| `[a]` link | `Linked 4 skill(s) from trae-cn`；list 显示 6 个名字，全部 on | 外部条目已创建，带 `groupPath`（其中 2 个为直接写入） |
| `[b]` 禁用子组 | 4 行 `Disabled "trae-cn.skills.*"`；list：4 off，2 on | 段级精确：`trae-cn/skills` 只匹配 skills 子组 |
| `[c]` 启用子组 | 4 行 `Enabled "trae-cn.skills.*"`；全部 6 个 on | toggle 可逆 |
| `[d]` 段边界 | exit=1，`no entries match group "trae-cn/skill"`；全部 6 个仍 on | `trae-cn/skill`（少 `s`）不匹配 `trae-cn/skills/*` |
| `[e]` 删除子组 | 4 行 `Removed "trae-cn.skills.*"`；list：剩 2 个 vendor | 批量删除限定于子组 |
| `[f]` 目录检查 | `user dir preserved` | 外部条目保留用户源目录 |
| `[g]` 删除 L1 组 | 2 行 `Removed "trae-cn.vendor_skills.*"`；list：空 | `trae-cn` 匹配所有子组 |
| `[h]` 空组 | exit=1，`no entries match group "trae-cn"` | 空组是错误，不是静默成功 |
| `[i]` 互斥 | exit=2，`--group cannot be combined with name patterns` | usage error，无条目被删除 |

---

## 实践中遇到的坑

1. **使用编译后的 CLI** — 演练使用 `lib/`；修改 `src/` 后先执行 `npm run build`。
2. **`--trae-cn-dir` 必须指定** — 不指定时 `link trae-cn` 查找 `~/.trae-cn`（测试机器上可能不存在）。该 flag 覆盖默认根目录。
3. **`link` 只扫描 `skills/`** — 第二子组（此处为 `vendor_skills/`）永远不会被 `link` 发现，必须像步骤 `[a]` 那样手工写入，而且要 **manifest 条目 + 符号链接两样齐**。只写 manifest 的条目没有链接，`list` 会显示 `off`，步骤 `[b]` 就分不出两个子组了。如果步骤 `[a]` 的 list 只有 4 个名字，说明写入片段未执行。
4. **段级精确 vs 字符串前缀** — 旧的 `startsWith` bug 会让 `trae-cn/skill` 匹配 `trae-cn/skills/*`。步骤 `[d]` 验证此问题不会复现。如果在步骤 `[d]` 看到全部 6 个条目被切换，说明修复未生效。
5. **外部条目不删除用户目录** — 步骤 `[f]` 验证了这一点。`remove --group` 只取消 manifest 注册并删除 symlink；用户源目录保留。
6. **managed 条目对 `--group` 不可见** — 它们没有 `groupPath`，组操作只影响 `link` 创建的外部条目。这是设计行为。
7. **确认守卫** — 不指定 `--yes` 时，匹配多个条目的组在 TTY 上弹出确认，在非 TTY 上拒绝（exit 2）。演练全程使用 `--yes` 以适配脚本执行；交互使用时应看到确认提示。
8. **`git init -b main` 需要 git >= 2.28** — 本演练未使用（环境创建的是普通目录而非 git 仓库），但如果用 `add` 条目扩展环境则会涉及。

---

## 覆盖边界

本指南**不**覆盖以下内容（设计如此）：

- **HTTP toggle 路由** — 面板的 `POST /skills-nexus/toggle` group 模式使用同一条段级精确规则；`test/api.test.ts` 覆盖。演练使用的 CLI 共享同一匹配逻辑。
- **面板组 UI** — 面板的组开关和 reconcile 谓词使用同一规则；`test/panel-render.test.ts` 覆盖渲染。
- **`remove --group` 确认提示** — 演练使用 `--yes` 以适配脚本执行。交互确认路径由 `test/remove-group.test.ts` 覆盖（confirm true → 执行；confirm false → 中止）。
- **JSON 输出格式** — `test/remove-group.test.ts` 断言空组的 version-1 机器报告（`results: []`，`summary.failed: 1`，exit 1）。演练使用人类可读输出。
- **Node 20 / 22 / 24 矩阵** — CI 在每次 push/PR 上运行完整质量门禁。
