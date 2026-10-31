# 验证列表加载与操作反应提速（P1–P4）

本指南验证 **面板列表加载与操作反应提速** 这几次提交所锁定的性能与语义契约。它们改变了列表 / 更新 / 启动路径的内部做法，但**不改变**链接归属、列表输出、组状态、退出码或补全等对外语义：

- **P1 · 链接扫描归并**：`listEntries` 把「每个 entry 各扫一遍根目录」归并为一次扫描——根只 `readdir` 一次、每链接解析一次、桶保持 `readdir` 原序、同一链接可同时入 parent 与 subdir 两个桶；归属、移除与冲突保护语义逐位不变。
- **P3 · 列表装饰有界池**：`listRoute` 的装饰段（target `stat` + frontmatter 读取）由嵌套无界 `Promise.all` 改为 `mapBounded(..., LINK_SCAN_CONCURRENCY = 8)`，两层都限 8；输出顺序与失败回退不变。
- **P2 · 面板全快照与轮询提前退避**：`reconcileList` 现返回 `{ entries, groupStates }`，面板成功收尾不再多发一次冗余 `api.list()`；`pollJob` 首两次等待固定 200ms、400ms，之后稳定回到 `intervalMs`（面板 800、helper 默认 1000 是两个不同稳态值）。
- **P4-1 · `checkUpdates` 远端并发**：`src/health.ts` 逐 entry 串行的 `git ls-remote` 改为常量 4 有界池 `UPDATE_CHECK_CONCURRENCY = 4`，结果仍按 manifest 顺序装配。
- **P4-2 · CLI 命令按需 import**：`src/cli/index.ts` 把 15 个命令模块与 usage 的顶层静态 import 改为 dispatcher 内 `await import(...)`，冷启动少加载未选中命令的传递图。

> **Shell 警告**：端到端测量块分别给出 Git Bash（Windows）与 POSIX/Linux/macOS 两种写法。所有块都用绝对路径或临时目录下的 `DSH_HOME`，测毕删除，绝不触碰你真实的 `~/.dsh`；只读真实 home 一节单列并附护栏。

## 前置条件

- Node.js ≥ 20（跑 client 构建需 `^22.18.0 || >=24.11.0`），且 `git` 在 `PATH` 中
- 已 checkout 仓库并 `npm install`（测试依赖 `node_modules` 里的 `tsx`）
- 若改过 `src/`，先 `npm run build`——下面的性能块跑的是 `lib/` 编译产物，测试块用 `tsx` 跑 `src/`
- 期望的是**量级与新旧分布分离**，不是硬阈值：不同机器、Windows Defender、文件系统都会平移绝对毫秒数

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
npm run lint        # ESLint 9 + typescript-eslint——期望：0 error
npm run build       # tsc → lib/
npm test            # node:test + tsx——期望：861 项 / 858 通过 / 3 跳过（bash/zsh/fish 补全实跑）/ 0 失败
```

聚焦到本次提交各自的回归锚点：

```bash
node --import tsx --test test/link-scan.test.ts     # P1 扫描归并：差分等价 + 五条不变量 + 有界并发
node --import tsx --test test/api.test.ts           # P3 装饰有界池：entry 与 link 顺序保持
node --import tsx --test test/health.test.ts        # P4-1 checkUpdates：结果顺序 + 并发上界
node --import tsx --test test/client-api.test.ts    # P2 reconcileList 全快照 + poll 早期退避序列
node --import tsx --test test/completions.test.ts   # P4-2 CLI dispatcher 源形：命令模块为动态 import
```

| 测试文件 | 验证内容 | 破坏对应提交时应转红 |
|---|---|---|
| `test/link-scan.test.ts` | 把改动前的逐 entry 实现保留为参照 oracle，同一未改动夹具上对批量桶与单条包装各做 `deepStrictEqual`（含顺序与 target 字符串）；夹具覆盖存活 managed/subdir/external、悬空 POSIX（`readlink` 恢复）与 Windows 悬空 junction（跳过、不虚构归属，分支由 `DANGLING_LINKS_OBSERVABLE` 选）、根内真实目录/普通文件、嵌套 parent+subdir 双桶、clone 缺失、根缺失（断言扫描不建根）、祖先被 `realpath` 重写、20 链接桶序 = `readdir` 序；`mapBounded` 反序完成仍按输入序返回且并发 `>1`（防空转假证）`且 ≤ 8` | 扫描改「首命中即分桶」→ 双桶用例红；打乱桶序 → 顺序用例红；无界扇出 → 并发上界红 |
| `test/api.test.ts` | 新增「list preserves entry and link order once the bounded decoration pool engages」：10 entry 外侧超上限、首 entry 9 链接内侧超上限，断言 `entries[i].name` = manifest 插入序、首 entry 的 `links.map(linkName)` = 对 skills 根重新 `readdir` 过滤的前缀序；另有既有 3 条 list 用例（空 manifest、`list-alpha` 单链接、`list-linked` ownership 外条）钉住响应形状 | 把 `mapBounded` 换成按完成序装配 → 顺序红；改响应 schema → 既有用例红 |
| `test/health.test.ts` | 注入执行器两条：（一）延迟随 index 递减（先启动者最晚完成），断言 `checkUpdates` 返回 `name` 序列逐位 = manifest 序；（二）`active/peak` 计数包住执行器，断言 `peak ≤ UPDATE_CHECK_CONCURRENCY` 且 `> 1`，`N = 10 >` 上限 | 结果按完成序装配 → 顺序红；并发无上界 → `peak ≤ 4` 红；池退化为串行 → `peak > 1` 红 |
| `test/client-api.test.ts` | `reconcileList` 返回含 `groupStates` 的全快照（tick/成功/超时三路径，旧响应缺字段回退空数组）；k 次轮询恰 k 次 list 调用（无 `k+1` 冗余）；注入 `sleep` 断言面板 `intervalMs:800` 长作业为 200/400/800/800…、helper 默认为 200/400/1000/1000…；首次即完成按 done/error/cancelled 各断言零 sleep；`maxWaitMs:0` 断言零 sleep（deadline 先于任何等待） | 稳态间隔被并入前两步 → sleep 序列红；成功收尾残留 `api.list()` → 计数 k≠k+1 红 |
| `test/completions.test.ts` | 源形断言「dispatcher loads command modules lazily, never as a top-level import」：`src/cli/index.ts` 不得再出现 `import … from './commands/'` 静态行，15 个命令模块恰以 `import('./commands/<x>.js')` 出现（`test-dist/` 无 `.ts` 时自跳过）；既有四类补全模板的 case-label 守卫继续逐字比对命令名 | dispatcher 改回顶层静态 import → 源形断言红 |

---

## 第二部分 — 端到端验证（性能复测）

下面两支脚本测同一条边界：**T1 = `listEntries`**、**T2 = 经注册 list handler 的完整 `listRoute`**（含装饰与 `deriveGroupStates`），外加 manifest-only 护栏。夹具为 \(N=10\) managed entry、\(L=50\) junction 链接指向 `repos/perf-eXX/skills/eXX-sK`，每 target 根部一个合法 frontmatter `SKILL.md`。每边界 3 warmup + 20 采样，报 median/p95，两次独立进程对照。

关键点：`src/paths.ts` 在 **import 期**读 `DSH_HOME` / `DSH_SKILLS_NEXUS_HOME`，所以夹具 home 必须在动态 import 应用模块**之前**设好；静态 import 之后再切变量不会迁移已加载的模块图。脚本用 `.mts`（`.ts` 会被 tsx 按 CJS 解析、拒绝 top-level await）。

### Git Bash / POSIX

```bash
PROJECT=/c/Users/you/dsh-skills-nexus           # ← 改成你的仓库路径（POSIX 形式）
TMP="$(mktemp -d)"
export PERF_REPO="$PROJECT" PERF_BASE="$TMP"

cat > "$TMP/bench.mts" <<'MJS'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const REPO = process.env.PERF_REPO, BASE = process.env.PERF_BASE
const pct = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) }
async function timeIt(fn) {
  for (let i = 0; i < 3; i++) await fn()
  const s = []
  for (let i = 0; i < 20; i++) { const t = performance.now(); await fn(); s.push(performance.now() - t) }
  s.sort((a, b) => a - b); return { median: pct(s, .5), p95: pct(s, .95) }
}
const home = await mkdtemp(join(BASE, 'home-'))
process.env.DSH_HOME = home
process.env.DSH_SKILLS_NEXUS_HOME = join(home, 'skills-nexus')   // 必须在动态 import 之前
const paths = await import(pathToFileURL(join(REPO, 'src', 'paths.ts')).href)
const manifest = await import(pathToFileURL(join(REPO, 'src', 'manifest.ts')).href)
const link = await import(pathToFileURL(join(REPO, 'src', 'link.ts')).href)
const routes = await import(pathToFileURL(join(REPO, 'src', 'http', 'routes.ts')).href)
const skills = []
for (let e = 0; e < 10; e++) {
  const ex = String(e).padStart(2, '0'), base = join(paths.repoDir(`perf-${ex}`), 'skills')
  await mkdir(base, { recursive: true })
  for (let k = 0; k < 5; k++) {
    const t = join(base, `perf-${ex}-s${k}`); await mkdir(t, { recursive: true })
    await writeFile(join(t, 'SKILL.md'), `---\nname: perf-${ex}-s${k}\n---\nbody\n`, 'utf8')
    await link.linkSkill(`perf-${ex}-s${k}`, t)
  }
  skills.push({ name: `perf-${ex}`, url: `github:owner/perf-${ex}#main`, gitUrl: `https://github.com/owner/perf-${ex}.git`, ref: 'main', path: `perf-${ex}`, subdir: 'skills', addedAt: new Date().toISOString() })
}
await manifest.writeManifest({ version: 1, skills })
const listed = await manifest.listEntries()
if (listed.length !== 10) throw new Error('fixture guard: entries != 10')
if (listed.reduce((n, l) => n + l.links.length, 0) !== 50) throw new Error('fixture guard: links != 50')
const spec = routes.createNexusRoutes().find((s) => s.path === '/skills-nexus/list')
const callList = async () => {
  const L = {}, req = { method: 'GET', url: '/skills-nexus/list', headers: {}, socket: {}, on: (e, c) => ((L[e] ??= []).push(c), req) }
  const done = Promise.resolve(spec.handler(req, { writeHead() {}, end() {} }))
  for (const cb of L.end ?? []) cb(); await done
}
console.log(JSON.stringify({ guard: await timeIt(() => manifest.readManifest()), t1: await timeIt(() => manifest.listEntries()), t2: await timeIt(callList) }))
await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
MJS

cd "$PROJECT"                       # 从仓库目录跑，--import tsx 才能解析到 tsx
node --import tsx "$TMP/bench.mts"  # 第一次
node --import tsx "$TMP/bench.mts"  # 第二次独立跑
rm -rf "$TMP"
```

> 把 `src/` 换成 `lib/` 并去掉 `--import tsx`、`PERF_REPO` 指 `lib`，即可跑编译产物版（需先 `npm run build`）；两者逻辑相同，只是模块解析器不同。

期望输出（量级，非硬阈值）：

```
guard  median ≈ 0.1–0.2 ms
t1     median ≈ 7–9 ms   （归并前逐 entry oracle 约 170–185 ms → 数量级差 ≈ 20×）
t2     median ≈ 11–13 ms （旧扫描+装饰参照约 167–200 ms）
```

实测记录（Windows 25H2 / Node v24.19.0 / tsx 4.23.12，夹具 `N=10 / L=50`，两次独立进程各 3 warmup + 20 采样，两次前置校验均 `entries=10, links=50`）：

| 边界 | Run 1 median/p95 (ms) | Run 2 median/p95 (ms) |
|---|---|---|
| manifest-only（护栏） | 0.11 / 0.18 | 0.17 / 0.25 |
| T1 `listEntries` | 7.88 / 8.65 | 7.44 / 8.87 |
| T2 完整 handler | 11.29 / 12.84 | 10.72 / 11.99 |

对照提交前基线（同一夹具、归并前实现）：T1 ≈ 185 / 174 ms、T2 ≈ 200 / 167 ms，装饰有界池接入后 T2 median 反而略低于纯 P1 的 ~12.5 ms，无回归。

### CLI 冷启动 A/B（P4-2）

静态 import 与动态 dispatcher 的差异只有约 30 ms，须用**每次全新进程**、隔离空 home 才测得出分布分离。

```bash
PROJECT=/c/Users/you/dsh-skills-nexus
TROOT="$(mktemp -d)"; export DSH_HOME="$TROOT/home" DSH_SKILLS_NEXUS_HOME="$TROOT/skills-nexus"
mkdir -p "$DSH_HOME/skills" "$DSH_SKILLS_NEXUS_HOME"     # manifest 缺失 → 走 No skills registered 早退，不触发 .corrupt 备份写
cd "$PROJECT"
# 已 npm run build；对 lib/cli/index.js 的 list 冷启动采样 20 次（另加 3 warmup），取 median/p95
node -e 'const {spawnSync}=require("child_process");const p=[];for(let i=0;i<23;i++){const r=process.hrtime.bigint();spawnSync("node",["lib/cli/index.js","list"],{stdio:"ignore"});p.push(Number(process.hrtime.bigint()-r)/1e6)}p.sort((a,b)=>a-b);const q=(s)=>p[Math.floor((p.length-1)*s)];console.log("list cold-start median",q(.5).toFixed(2),"p95",q(.95).toFixed(2))'
rm -rf "$TROOT"
```

期望量级（Windows 25H2 / Node v24.19.0）：裸 `node -p 0` 地板 ≈ 55 ms；动态 dispatcher `list` ≈ 97–102 ms；改回顶层静态 import 后 ≈ 129–131 ms。新旧分布应干净分离（实测旧 min 124.46 vs 新 max 108.25），否则说明未生效或噪声过大。

### 真实 `~/.dsh`（只读，可选）

真实 home 单独测且**只读**：调用 list 路径前必须确认 manifest 有效或不存在，否则 `readManifest` 解析失败会写 `.corrupt-…` 备份。无法保证就停止、如实报告。测毕对照前后快照（目录清单、manifest 的 size:mtime）应逐位不变。合成与真实两组数据分开报告。

---

## 值得知道的实现行为（不是缺陷）

1. **`realpath` 是列表路径上最大的非 idle CPU 类目**：扫描每条链接解析一次 + 基路径规范化一次。CPU 剖面（每路径 30 s 预算，采样帧不是 FS 调用计数器）T2 self：idle 66.3%、fs-native 11.4%（含装饰 `stat(link.target)` 3.3%）、decor(app+yaml) 7.6%（yaml `.next` 2.0%、`locateSkillFiles` 0.6%——root `SKILL.md` 早退实测存在）、(program) 6.8%、node-internal 5.6%、scan(app) 1.5%、route-shell 0.4%。
2. **`checkUpdates` 进度行的发射顺序在并发下不确定**：`io.progress` 是 best-effort 提示、非契约，池化后各 worker 的进度行到达次序不再固定。`test/update-pipeline.test.ts` 对 `io.stages` 的断言**有意**两边 `.sort()` 后按集合比较——不要改回按序断言；结果数组顺序另由 `deepStrictEqual` 与专用 keeps-order 用例钉住。
3. **两个并发常量刻意不同**：`LINK_SCAN_CONCURRENCY = 8` 约束廉价的本机 `readlink`/`realpath`；`UPDATE_CHECK_CONCURRENCY = 4` 约束「每 entry 一个 `git ls-remote` 子进程 + 一条外网连接」，取 4 覆盖多数 manifest 规模又把进程/连接足迹压小，也避免与扫描池混为一谈。
4. **`locateSkillFiles` 已对根部 `SKILL.md` 做 `isFile` 早退**：任何「单文件化」提案不得声称该快速路径不存在；每次 list 仍读当前 frontmatter 真值，跨请求名称缓存不能替代。

---

## 实践中遇到的坑

1. **import 期读 env。** `DSH_HOME` / `DSH_SKILLS_NEXUS_HOME` 必须在动态 import `src`/`lib` 之前设置；从**工作区外**跑 `node --import tsx` 会 `ERR_MODULE_NOT_FOUND: tsx`——须 `cd` 回仓库目录再传脚本绝对路径，或用 `.mjs` + `lib/` 免 `tsx`。
2. **夹具前置校验别省。** 断言实际 `entries == 10 && links == 50`，不能假设循环造出了 50 个可用 junction；`mkdtemp` 的 home 要在 `linkSkill` 建根之后测、并在 `after`/末尾删净。
3. **`Promise.all → mapBounded` 必须按索引装配。** 池的 worker 乱序完成，若按完成序 push 会破坏 `entries`（manifest 序）与 `links`（`readdir` 序）；`test/api.test.ts` 与 `test/link-scan.test.ts` 的顺序用例专防此。
4. **Windows 悬空 junction。** `readlink` 报 `EINVAL`、`lstat` 当它是普通目录，只有 `realpath` 能解析；不可恢复的悬空 junction 应跳过而非从链接名虚构归属——`test/link-scan.test.ts` 用 `DANGLING_LINKS_OBSERVABLE` 显式选该分支。
5. **只读真实 home。** 见第二部分：先确认 manifest 有效/不存在以避开 `.corrupt-…` 备份写；临时脚本、剖面一律放真实 home 之外，测毕删除并 `Test-Path`/存在性验证。
6. **PowerShell 5.1 三坑。** 勿用 `Get-Content | Set-Content` 往返改写含非 ASCII 的源文件（默认编码会引入 FFFD）；`npm test` 输出为中文本地化（`ℹ pass`/`ℹ fail`），`Select-String 'fail'` 空捕、取尾部行更稳；`npm run build/typecheck/lint` 首行的 PowerShell 报错样式属 notice 噪音，以 `$LASTEXITCODE` 为准；跨 shell 用 `git -C <dir>`、不留 `cd` 副作用。

---

## 覆盖边界

本指南**不**覆盖（皆为刻意取舍）：

- **绝对毫秒阈值。** 合成夹具数字是量级参照，换机器 / Defender / 文件系统会平移；判据是新旧分布分离与相对提升，不是某个固定 ms。
- **真实 `~/.dsh` 群体的提速裁决。** 记录时真实 home 处于 `N=0 / L=0`（空载地板：T1 ≈ 0.10 ms、T2 ≈ 0.15 ms），只证「只读护栏不触发写入」，不作裁决依据。
- **真实 git 网络并发。** `test/health.test.ts` 的顺序 + 上界用例用注入执行器观测在飞数，不跑真实 `git ls-remote`；真实 git 六态矩阵由 `test/update-pipeline.test.ts` 负责。
- **面板浏览器交互。** `test/panel-render.test.tsx` 是 SSR 静态渲染守卫、不跑 effect，不作点击/轮询/请求计数证据；那些由 `test/client-api.test.ts` 的编排 mock 承担。
- **对外语义变更。** 本方案不新增命令或 flag，不改归属、移除/冲突保护、`list --json` schema、组状态推导、退出码与补全，因此不更新 README 的用户可见章节。
