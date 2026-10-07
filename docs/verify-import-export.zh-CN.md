# 验证 export / import / adopt

本指南验证**包通道**（[sources-and-packages.md](sources-and-packages.zh-CN.md) 中的通道 C 和 D）：

- **`export`** — 将一个或多个条目打包为 zip，附带 `nexus-package.json` 标签记录来源元数据。
- **`import`** — 从包中重建条目，标签中的 url 可达时优先走 git 重新克隆；`--locked` 则恢复标签记录的精确 commit，仅当该 commit 不可获取时回退载荷。
- **`adopt`** — 给冻结（无 git 源）条目一个真正的 git 身份，使其可更新。

以下操作均安全：不会触碰你的真实 `~/.dsh`，不会联系任何 GitHub 仓库，当前仓库只读（或通过 `npm run build` 重建）。所有临时状态位于专用临时目录中，最后删除。

## 前置条件

- Node.js >= 18，git 在 `PATH` 中
- 仓库已检出并执行过 `npm install`
- 如果修改了 `src/`，先执行 `npm run build`——演练使用 `lib/` 中的编译后 CLI

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck     # tsc --noEmit（严格模式）
npm run lint          # ESLint 9 + typescript-eslint
npm run test:build    # 把 src+test 编译到 test-dist/
npm run build         # tsc -> lib/
npm run build:client  # 浏览器 bundle + client 声明
npm test              # node:test + tsx——预期：全部通过
```

相关测试覆盖：

| 测试文件 | 验证内容 |
|---|---|
| `test/export.test.ts` | 标签结构、载荷（不含 `.git`）、PKZip 往返、`ownership: 'external'` 边界、`--all` 包含禁用条目、CLI 表面 |
| `test/import.test.ts` | 标签驱动的 git 恢复 vs 快照回退；`--locked` 在分支移动后精确 detached 恢复、仅 commit unavailable 回退、远端缺失硬失败、元数据/flag 校验、`--each` 独立 clone；以及剥壳扫描、`--dry-run`、状态还原、裸包与错误分级 |
| `test/adopt.test.ts` | 七步编排、技能集比对、备份/恢复、链接重建、`--force` 换源、`--prune`、失败回退（逐字节 manifest/链接/目录恢复）、外部条目拒绝 |
| `test/zip.test.ts` | PKZip 编解码器：往返、zip-slip 拒绝、`.git` 跳过、体积/条目上限、加密拒绝 |

测试套件覆盖的锁定导入检查点：

1. 在 commit A 导出 labelled entry，再将来源分支推进到 B。
2. 用 `--locked` 导入；`git rev-parse HEAD` 仍为 A，且 HEAD detached。
3. `list` 报告 `LOCK=yes`；`doctor --updates` 将其识别为精确 package commit，而非普通 detached pin。
4. 成功执行 `switch-version` 后显式锁被清除。
5. 只有远端明确报告 A 不可获取时才使用包内快照；远端缺失、认证失败、不安全元数据与含糊的 Git 错误均失败。

---

## 第二部分 — 端到端演练

每个平台一份复制粘贴。将 `PROJECT` 替换为你的检出路径。步骤 `[a]`–`[i]` 覆盖完整行为面。

### Windows（Git Bash / MINGW64）

```bash
# ---- 准备：两个假远程仓库，各一个技能 ----
REPO_A="$(cygpath -m "$TEMP/nexus-vr/repo-a")"
REPO_B="$(cygpath -m "$TEMP/nexus-vr/repo-b")"
DEMO="$(cygpath -m "$TEMP/nexus-vr-demo")"
rm -rf "$TEMP/nexus-vr" "$DEMO"
mkdir -p "$REPO_A" "$REPO_B"
printf -- '---\nname: alpha-skill\ndescription: Alpha\n---\nAlpha body\n' > "$REPO_A/SKILL.md"
printf -- '---\nname: beta-skill\ndescription: Beta\n---\nBeta body\n' > "$REPO_B/SKILL.md"
cd "$REPO_A" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init
cd "$REPO_B" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/Downloads/dsh-skills-nexus                  # <- 你的路径
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] 添加两个条目 ---"
node lib/cli/index.js add "file:///$REPO_A"
node lib/cli/index.js add "file:///$REPO_B"
node lib/cli/index.js list
# 预期：alpha-skill 和 beta-skill 均已列出，均为 on

echo "--- [b] 禁用 beta，然后 export --all ---"
node lib/cli/index.js disable beta
node lib/cli/index.js export --all -o "$DEMO/migrate.zip"
# 预期："2 entries, N files -> migrate.zip (zip)"

echo "--- [c] 检查包标签 ---"
cd "$DEMO" && mkdir -p inspect && cd inspect
unzip -o ../migrate.zip nexus-package.json >/dev/null 2>&1
cat nexus-package.json
# 预期：两个条目；alpha enabled=true，beta enabled=false；
# 两者均有 gitUrl 指向 file:///... 远程
cd "$PROJECT"

echo "--- [d] 导入到全新 DSH_HOME（跨机模拟） ---"
DEMO2="$(cygpath -m "$TEMP/nexus-vr-demo2")"
rm -rf "$DEMO2"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/migrate.zip" --dry-run
# 预期：两个候选，均为 "will clone from file:///... (main)"
node lib/cli/index.js import "$DEMO/migrate.zip"
node lib/cli/index.js list
# 预期：alpha-skill on，beta-skill off（状态从标签还原）

echo "--- [e] 验证导入的条目可更新 ---"
node lib/cli/index.js update alpha
# 预期：update 成功（从标签恢复了 git 源）

echo "--- [f] 裸包（无标签）-> 快照 ---"
BARE="$(cygpath -m "$TEMP/nexus-bare")"
rm -rf "$BARE"; mkdir -p "$BARE"
printf -- '---\nname: gamma-skill\ndescription: Gamma\n---\nGamma body\n' > "$BARE/SKILL.md"
cd "$BARE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm bare
cd "$PROJECT"
# 制作一个没有 nexus-package.json 标签的 zip
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$BARE', 'SKILL.md'));
const arch = createZip([{ name: 'SKILL.md', data }]);
fs.writeFileSync('$DEMO/bare.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/bare.zip" --dry-run
# 预期："manifest: none (source unknown)"，"will import as snapshot (source unknown)"
node lib/cli/index.js import "$DEMO/bare.zip"
node lib/cli/index.js list | grep gamma
# 预期：gamma-skill 已列出，无 git 源（不能 update）
node lib/cli/index.js update gamma; echo "exit=$?"
# 预期：exit=1，"has no git source"

echo "--- [g] adopt 转正快照 -> 可更新 ---"
node lib/cli/index.js adopt gamma --url "file:///$BARE"
node lib/cli/index.js list | grep gamma
# 预期：gamma-skill 现在有 git 源，可更新
node lib/cli/index.js update gamma; echo "exit=$?"
# 预期：exit=0，update 成功

echo "--- [h] 错误分级：嵌套过深 ---"
DEEP="$(cygpath -m "$TEMP/nexus-deep")"
rm -rf "$DEEP"; mkdir -p "$DEEP/w1/w2/w3/w4"
printf -- '---\nname: deep-skill\ndescription: Deep\n---\nD\n' > "$DEEP/w1/w2/w3/w4/SKILL.md"
cd "$DEEP" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm deep
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$DEEP', 'w1/w2/w3/w4/SKILL.md'));
const arch = createZip([{ name: 'w1/w2/w3/w4/SKILL.md', data }]);
fs.writeFileSync('$DEMO/deep.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/deep.zip" --dry-run; echo "exit=$?"
# 预期：exit=1，"skill-nested-too-deep" 附位置和深度

echo "--- [i] 清理 ---"
rm -rf "$TEMP/nexus-vr" "$DEMO" "$DEMO2" "$BARE" "$DEEP"
unset DSH_HOME
```

### Linux / macOS

同样的命令，使用纯绝对路径（无 `cygpath`）：

```bash
# ---- 准备 ----
REPO_A=/tmp/nexus-vr/repo-a
REPO_B=/tmp/nexus-vr/repo-b
DEMO=/tmp/nexus-vr-demo
rm -rf /tmp/nexus-vr "$DEMO"
mkdir -p "$REPO_A" "$REPO_B"
printf -- '---\nname: alpha-skill\ndescription: Alpha\n---\nAlpha body\n' > "$REPO_A/SKILL.md"
printf -- '---\nname: beta-skill\ndescription: Beta\n---\nBeta body\n' > "$REPO_B/SKILL.md"
cd "$REPO_A" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init
cd "$REPO_B" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm init

PROJECT=~/dsh-skills-nexus                            # <- 你的路径
cd "$PROJECT"
export DSH_HOME="$DEMO"

echo "--- [a] 添加两个条目 ---"
node lib/cli/index.js add "file://$REPO_A"
node lib/cli/index.js add "file://$REPO_B"
node lib/cli/index.js list

echo "--- [b] 禁用 beta，然后 export --all ---"
node lib/cli/index.js disable beta
node lib/cli/index.js export --all -o "$DEMO/migrate.zip"

echo "--- [c] 检查包标签 ---"
cd "$DEMO" && mkdir -p inspect && cd inspect
unzip -o ../migrate.zip nexus-package.json >/dev/null 2>&1
cat nexus-package.json
cd "$PROJECT"

echo "--- [d] 导入到全新 DSH_HOME ---"
DEMO2=/tmp/nexus-vr-demo2
rm -rf "$DEMO2"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/migrate.zip" --dry-run
node lib/cli/index.js import "$DEMO/migrate.zip"
node lib/cli/index.js list
# 预期：alpha-skill on，beta-skill off

echo "--- [e] 验证导入的条目可更新 ---"
node lib/cli/index.js update alpha

echo "--- [f] 裸包 -> 快照 ---"
BARE=/tmp/nexus-bare
rm -rf "$BARE"; mkdir -p "$BARE"
printf -- '---\nname: gamma-skill\ndescription: Gamma\n---\nGamma body\n' > "$BARE/SKILL.md"
cd "$BARE" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm bare
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$BARE', 'SKILL.md'));
const arch = createZip([{ name: 'SKILL.md', data }]);
fs.writeFileSync('$DEMO/bare.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/bare.zip" --dry-run
node lib/cli/index.js import "$DEMO/bare.zip"
node lib/cli/index.js list | grep gamma
node lib/cli/index.js update gamma; echo "exit=$?"

echo "--- [g] adopt 转正快照 -> 可更新 ---"
node lib/cli/index.js adopt gamma --url "file://$BARE"
node lib/cli/index.js list | grep gamma
node lib/cli/index.js update gamma; echo "exit=$?"

echo "--- [h] 错误分级：嵌套过深 ---"
DEEP=/tmp/nexus-deep
rm -rf "$DEEP"; mkdir -p "$DEEP/w1/w2/w3/w4"
printf -- '---\nname: deep-skill\ndescription: Deep\n---\nD\n' > "$DEEP/w1/w2/w3/w4/SKILL.md"
cd "$DEEP" && git init -b main >/dev/null && git config user.email t@t && git config user.name t
git add . && git commit -qm deep
cd "$PROJECT"
node -e "
const { createZip } = require('./lib/zip.js');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join('$DEEP', 'w1/w2/w3/w4/SKILL.md'));
const arch = createZip([{ name: 'w1/w2/w3/w4/SKILL.md', data }]);
fs.writeFileSync('$DEMO/deep.zip', arch);
"
export DSH_HOME="$DEMO2"
node lib/cli/index.js import "$DEMO/deep.zip" --dry-run; echo "exit=$?"

echo "--- [i] 清理 ---"
rm -rf /tmp/nexus-vr "$DEMO" "$DEMO2" "$BARE" "$DEEP"
unset DSH_HOME
```

---

## 每步预期输出

| 步骤 | 预期输出 | 含义 |
|---|---|---|
| `[a]` add | `Added skill "alpha-skill"` / `"beta-skill"`，list 显示均为 on | 两个独立 git 条目 |
| `[b]` export | `2 entries, N files -> migrate.zip (zip)` | 包包含禁用条目 |
| `[c]` 标签 | JSON 含两个条目；alpha `enabled: true`，beta `enabled: false`；两者均有 `gitUrl` | 标签记录来源 + 状态 |
| `[d]` import | `--dry-run`：两行 `will clone from file:///... (main)`；正式导入：alpha on，beta off | git 恢复 + 状态还原 |
| `[e]` update | `update` 在导入条目上成功 | 来源已从标签恢复 |
| `[f]` 裸包导入 | `--dry-run`：`manifest: none (source unknown)`，`will import as snapshot`；`update gamma` 退出 1 | 快照无 git 源 |
| `[g]` adopt | `Attached file:///... (main, <sha>) to "gamma"`；`update gamma` 退出 0 | 冻结条目变为可更新 |
| `[h]` 嵌套 | `skill-nested-too-deep` 附深度和位置，退出 1 | 错误分级区分深度与缺失 |

---

## 实践中见过的陷阱

1. **同一 `$DSH_HOME` 会累积条目** — 步骤 `[a]`–`[h]` 共享演示环境；后续的 `list` 输出包含前面的条目。按名称断言，不按总数。
2. **`file://` 远程与稀疏警告** — 本地远程默认 `uploadpack.allowFilter` 关闭，git 仍会下载对象。克隆正常工作；可能看到 `the remote ignored the blob filter` 警告。不是错误。
3. **平台路径** — Windows Git Bash：`cygpath -m` + `file:///C:/...`；Linux / macOS：纯绝对路径 + `file:///tmp/...`。
4. **`git init -b main` 需要 git >= 2.28** — 更旧版本：`git init && git symbolic-ref HEAD refs/heads/main`。
5. **运行编译后的 CLI** — 演练使用 `lib/`；修改 `src/` 后需 `npm run build` 重建。
6. **`node -e` 制作裸 zip** — 演练用内联 Node 创建不含标签的 zip（模拟第三方包）。这仅用于测试准备；真实包来自 `export` 或其他工具。

---

## 覆盖边界

- **真实 GitHub 网络** — 本地 `file://` 远程模拟相同的 git 语义，无网络抖动。对真实 GitHub 仓库的运行应表现一致。
- **面板导入 UI** — 面板的文件选择器 + 预览 + 确认流程由 `test/panel-render.test.ts` 覆盖；本演练使用的 CLI 是面板和命令行通过 `src/import.ts` 共享的。
- **`--each` 范围** — 演练将整包作为一个条目导入；`test/import.test.ts` 覆盖 `--each`，包括 `--each --locked` 为每个 skill 创建锁在同一记录 commit 的独立 clone。
- **外部条目** — `export --all` 跳过 `ownership: 'external'` 条目由 `test/export.test.ts` 覆盖；演练不创建外部条目（需要 `--link-only` 设置）。
- **Node 20 / 22 / 24 矩阵** — CI 在 push/PR 时运行完整门禁集。
