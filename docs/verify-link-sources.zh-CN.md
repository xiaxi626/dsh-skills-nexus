# 验证本地来源链接

[English](verify-link-sources.md)

> **Shell 警告**：本页 `bash` 代码块用于 Windows Git Bash 或 Linux/macOS Bash，不要粘贴到 PowerShell/cmd。请在本仓库根目录打开终端，整体执行代码块。脚本不切换目录、不执行 Git 写操作，也不需要全局 `npm link`。

本指南验证 [通道 E](sources-and-packages.zh-CN.md#通道-e外部引用link) 当前启用来源（撰写时为 `trae-cn`、`trae` 与 `qoder`）、目录覆盖与面板流程。启用来源由 `src/external.ts` 中的 `SOURCE_CONFIGS` 决定；新增来源时请同步更新契约表与演练覆盖。CLI 演练使用编译后的 `lib/cli/index.js`，临时状态完全隔离；面板验收需要另行启动测试宿主，不能把 CLI 成功等同于 UI 集成成功。

## 前置条件与两步构建

- 已安装项目依赖。CLI 支持 Node.js >= 20；本页连同客户端构建建议使用 Node.js 24，避免旧版 Node 不满足 `tsdown` 的运行要求。
- Windows 使用 Git Bash；链接校验采用 `realpath`，兼容 Windows junction 与 Unix symlink。
- `npm run build` 只编译服务端/CLI；`npm run build:client` 另行生成 `lib/client.js`、source map 和 `lib/client-types/` 类型声明。只运行前者不能验证面板已更新。

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  npm run build
  npm run build:client
  npm run typecheck
  npm run lint
  npm run test:build
)
```

期望全部退出 0。检查已提交产物是否新鲜时，可运行 `git diff --exit-code -- lib/`；有差异就核对并重建，不要手改生成文件，也不要自动丢弃原有工作区改动。

## 自动回归测试

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  node --import tsx --import ./test/register-css.mjs --test \
    test/external-link.test.ts test/external-qoder.test.ts \
    test/cli-link.test.ts test/args.test.ts \
    test/api.test.ts test/client-api.test.ts \
    test/completions.test.ts test/panel-render.test.tsx
)
```

| 测试文件 | 验证内容 |
|---|---|
| `external-link.test.ts` | 三种来源配置、环境变量、覆盖不回退、多候选根顺序、目录去重及同名管理条目优先根胜出、一层扫描边界 |
| `external-qoder.test.ts` | qoder 布局：带/不带版本层的安装、`skills` 为字符串或数组、`./skills/` 兜底、一层边界、禁用与缺失安装、`qoder-bundler` 整组排除、用户级优先 |
| `cli-link.test.ts` / `args.test.ts` | 预览/执行、JSON、冲突与 force、group、新旧参数及空值拒绝 |
| `api.test.ts` / `client-api.test.ts` | `sourceDir` 的预览/确认执行透传、旧 `traeCnDir` 兼容、错误响应 |
| `completions.test.ts` | 四模板 link 分支提供新旧目录参数；已安装的 shell 另跑实际补全 |
| `panel-render.test.tsx` | 三个启用按钮、三个禁用占位、路径输入框；仅静态渲染，不模拟点击 |

发布前另跑 `npm test` 和 `npm run test:local-source`。缺少 shell 导致的 skip 必须单独记录，不能算通过；全量测试和远端跨平台 CI 也不能由聚焦测试代替。

## CLI 隔离演练

下表是行为契约；不要为验证默认路径而创建或修改真实用户目录。

| 来源 | 默认扫描位置 | 环境变量 |
|---|---|---|
| `trae-cn` | `~/.trae-cn/skills/` | `TRAE_CN_DIR` |
| `trae` | `~/.trae/skills/` | `TRAE_DIR` |
| `qoder` | `~/.qoder/skills/` + 每个市场插件声明的目录 | `QODER_DIR` |

上表反映当前 `SOURCE_CONFIGS`。新增来源登记时，同步扩展表格与演练覆盖。

优先级：`--source-dir` > `--trae-cn-dir`（兼容别名）> 当前来源环境变量 > 默认根。参数传**根目录**，不是它下面的 `skills/`——`qoder` 即 `~/.qoder`。覆盖无效时失败，不回退。默认路径和多根候选逻辑由上面的核心测试覆盖；下面演练只扫描临时目录。

整体运行以下代码块。Node 驱动真实编译后 CLI，每个子进程显式设置 `DSH_HOME`、`DSH_SKILLS_NEXUS_HOME` 和三个来源环境变量，不改变当前终端的环境。成功或断言失败都会在 `finally` 清理此次创建的临时目录；强制结束进程导致残留时，只清理输出的 `fixture:` 路径。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
assert.equal(JSON.parse(await readFile('package.json', 'utf8')).name, 'dsh-skills-nexus')
const cli = resolve('lib/cli/index.js')
await access(cli)
const base = await mkdtemp(join(tmpdir(), 'nexus-verify-link-'))
console.log(`fixture: ${base}`)
const roots = Object.fromEntries(['trae', 'trae-cn', 'qoder', 'alias', 'override'].map(k => [k, join(base, k)]))
const env = {
  ...process.env,
  DSH_HOME: join(base, 'home'),
  DSH_SKILLS_NEXUS_HOME: join(base, 'nexus'),
  TRAE_DIR: roots.trae,
  TRAE_CN_DIR: roots['trae-cn'],
  QODER_DIR: roots.qoder,
}
const md = '---\nname: demo\ndescription: isolated link verification\n---\nBody\n'
const pluginMd = '---\nname: plugin-demo\ndescription: isolated plugin link verification\n---\nBody\n'
function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result
}
const json = (...args) => JSON.parse(run([...args, '--json']).stdout)
const preview = (source, ...flags) => json('link', source, '--dry-run', ...flags).plan
const skillDir = root => join(root, 'skills', 'demo')
const linkPath = name => join(env.DSH_HOME, 'skills', name)
const names = () => run(['list', '--names']).stdout.trim()
try {
  for (const root of Object.values(roots)) {
    await mkdir(skillDir(root), { recursive: true })
    await writeFile(join(skillDir(root), 'SKILL.md'), md)
  }
  for (const sub of ['builtin_skills/demo', 'skills/nested/deep', 'skills/.hidden']) {
    const dir = join(roots.trae, sub)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), md)
  }
  const qoderPlugin = join(roots.qoder, 'plugins', 'cache', 'qoder-marketplace', 'demo-plugin', '1.0.0')
  await mkdir(join(qoderPlugin, '.qoder-plugin'), { recursive: true })
  await writeFile(join(qoderPlugin, '.qoder-plugin', 'plugin.json'), JSON.stringify({ name: 'demo-plugin', skills: './skills/' }))
  await mkdir(join(qoderPlugin, 'skills', 'plugin-demo'), { recursive: true })
  // 独立的 frontmatter name：同名技能会按名去重，插件条目就会被吞掉。
  await writeFile(join(qoderPlugin, 'skills', 'plugin-demo', 'SKILL.md'), pluginMd)
  await writeFile(join(roots.qoder, 'plugins', 'installed_plugins_v2.json'), JSON.stringify({
    plugins: { 'demo-plugin@qoder-marketplace': [{ enabled: true, installPath: qoderPlugin }] },
    version: 2,
  }))
  for (const source of ['trae', 'trae-cn']) {
    const plan = preview(source)
    assert.equal(plan.source, source)
    assert.equal(plan.entries.length, 1)
    assert.equal(plan.entries[0].name, `${source}.skills.demo`)
    assert.equal(plan.entries[0].externalDir, skillDir(roots[source]))
    await assert.rejects(lstat(linkPath(`${source}.skills.demo`)), { code: 'ENOENT' })
  }
  assert.equal(names(), '')
  assert.match(run(['link', 'trae', '--dry-run']).stdout, /Would create 1 entry/)
  console.log('PASS preview: two independent sources, JSON, no writes, one-level scan')

  const qoder = preview('qoder')
  assert.equal(qoder.source, 'qoder')
  assert.deepEqual(qoder.entries.map(e => e.name).sort(), ['qoder.demo-plugin.plugin-demo', 'qoder.skills.demo'])
  assert.equal(preview('qoder', '--source-dir', roots.qoder).entries.length, 2)
  console.log('PASS qoder: user-level skills plus marketplace plugin skills, one level each')

  assert.equal(preview('trae-cn', '--trae-cn-dir', roots.alias).entries[0].externalDir, skillDir(roots.alias))
  for (const source of ['trae', 'trae-cn']) {
    for (const flags of [
      ['--source-dir', roots.override, '--trae-cn-dir', roots.alias],
      ['--trae-cn-dir', roots.alias, `--source-dir=${roots.override}`],
    ]) {
      assert.equal(preview(source, ...flags).entries[0].externalDir, skillDir(roots.override))
    }
  }
  const missing = run(['link', 'trae', '--source-dir', join(base, 'missing'), '--dry-run'], 1)
  assert.match(missing.stderr, /--source-dir.*TRAE_DIR/)
  assert.match(run(['link', 'unknown-source', '--dry-run'], 1).stderr, /supported sources: trae-cn, trae/)
  run(['link', 'trae', '--source-dir', '--json'], 2)
  assert.equal(names(), '')
  console.log('PASS overrides: new flag > alias > environment; missing root fails; invalid args fail')

  const first = json('link', 'trae')
  assert.deepEqual(first.result, { added: ['trae.skills.demo'], skipped: [] })
  assert.equal(await realpath(linkPath('trae.skills.demo')), await realpath(skillDir(roots.trae)))
  const duplicate = json('link', 'trae', '--source-dir', roots.override)
  assert.deepEqual(duplicate.result, { added: [], skipped: ['trae.skills.demo'] })
  assert.equal(await realpath(linkPath('trae.skills.demo')), await realpath(skillDir(roots.trae)))
  assert.deepEqual(preview('trae').conflicts, ['trae.skills.demo'])
  const forced = json('link', 'trae', '--source-dir', roots.override, '--force')
  assert.deepEqual(forced.result, { added: ['trae.skills.demo'], skipped: [] })
  assert.equal(await realpath(linkPath('trae.skills.demo')), await realpath(skillDir(roots.override)))
  console.log('PASS execution: register, skip conflict, force retarget')

  assert.match(run(['link', 'trae-cn', '--source-dir', roots['trae-cn']]).stdout, /Linked 1 skill/)
  json('link', 'trae', '--group', 'custom-link-check')
  const entries = JSON.parse(await readFile(join(env.DSH_SKILLS_NEXUS_HOME, 'manifest.json'), 'utf8')).skills
  assert.equal(entries.length, 3)
  assert.ok(entries.every(e => e.ownership === 'external'))
  const custom = entries.find(e => e.name === 'custom-link-check.skills.demo')
  assert.deepEqual(custom.groupPath, ['custom-link-check', 'skills', 'demo'])
  assert.equal(custom.url, 'trae:skills/demo')
  for (const entry of entries) {
    assert.equal(await realpath(linkPath(entry.name)), await realpath(entry.externalDir))
  }
  console.log('PASS groups: independent default groups, custom group keeps source identity')

  for (const group of ['trae', 'trae-cn', 'custom-link-check']) run(['remove', '--group', group, '--yes'])
  assert.equal(names(), '')
  for (const entry of entries) await assert.rejects(lstat(linkPath(entry.name)), { code: 'ENOENT' })
  for (const root of Object.values(roots)) assert.equal(await readFile(join(skillDir(root), 'SKILL.md'), 'utf8'), md)
  console.log('PASS removal: registrations and links gone; external files unchanged')
} finally {
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  console.log(`cleaned: ${base}`)
}
NODE
```

通过标准：6 行 `PASS`、一行 `cleaned:`，进程退出 0。不能只看最后的清理输出；断言失败时同样会清理。卸载与 fixture 删除是两件事：先断言 `remove --group` 保留源文件，最后才由测试脚本删除它自己创建的临时文件。

### 插件升级后怎么办

qoder 的 `installPath` 通常带版本层（`…/superpowers/6.3.0`），插件一升级，该目录就被换掉，指向它的链接全部悬空。此时 `doctor` 会报 `missing-target`——外部来源创建的链接不参与 orphan 扫描——但它给出的修复提示是 `update <name>`，只对 git 条目有效。正确处置是重新链接：`link qoder --force` 会把已有扁平名重新指向新的安装目录，名字不变。

## 面板真实宿主验收（手动）

### 准备专用环境

不要直接在日常宿主上点击执行。先用下面代码创建另一套临时 fixture；它不会自动删除，供宿主进程使用，结束后按本节清理。

```bash
node --input-type=module <<'NODE'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const base = await mkdtemp(join(tmpdir(), 'nexus-panel-link-'))
for (const source of ['trae', 'trae-cn', 'custom']) {
  const dir = join(base, source, 'skills', 'panel-demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: panel-demo\ndescription: isolated panel verification\n---\nBody\n')
}
console.log(JSON.stringify({
  fixtureRoot: base,
  DSH_HOME: join(base, 'home'),
  DSH_SKILLS_NEXUS_HOME: join(base, 'nexus'),
  TRAE_DIR: join(base, 'trae'),
  TRAE_CN_DIR: join(base, 'trae-cn'),
  sourceDir: join(base, 'custom'),
  missingDir: join(base, 'missing'),
}, null, 2))
NODE
```

1. 保存输出。在**新开的测试终端**中，把输出中的四个环境变量赋给即将启动的 DSH 进程；不改系统永久环境变量。CLI 子进程设置不会影响已经运行的宿主。
2. 只复用 [README 本地测试步骤](../README_CN.md#本地测试步骤) 的 overlay/宿主启动部分，装载本检出的 `lib/index.js`，不要执行其中真实目录的技能安装示例。使用专用测试宿主配置与空闲端口；不要覆盖已有 overlay 或改日常 profile。DSH 初始化可能需要其自身的依赖/配置，不属于本指南的离线 CLI 演练。
3. 先完成两步构建，再冷启动测试宿主并刷新浏览器，确保加载当前 `lib/client.js`。确认 Nexus 列表为空；若出现日常条目，立即停止，检查两个 DSH 路径变量，**不要执行链接或删除**。
4. 打开设置中的 Skills Nexus，展开 `link local skills`。浏览器 Network 过滤 `/skills-nexus/link`；路径指的是**服务端文件系统**，不是浏览器所在机器。

### 操作与判据

| 操作 | 预期 UI / 请求 |
|---|---|
| 查看来源按钮 | Trae CN、Trae、Qoder 可用；Claude Code、WorkBuddy、Qoder CN 禁用 |
| 输入留空，点击 Trae | `source: "trae"`、`confirm: false`，不发送 `sourceDir`；预览 `trae.skills.panel-demo`，列表仍为空 |
| 在预览后点击 `link` | `source: "trae"`、`confirm: true`；受理 202，任务完成后出现 external 条目 |
| 移除这次新建的 Trae 组 | 确认后条目消失；`TRAE_DIR/skills/panel-demo/SKILL.md` 仍在 |
| 填入输出的 `sourceDir`，点击 Trae 并执行 | 两次请求都带同一个 `sourceDir`；预览/条目的目标在 `custom/skills/panel-demo` |
| 点击 Trae CN 预览（不执行） | `source: "trae-cn"`，保留填写的 `sourceDir`；不回退为 Trae |
| 有预览时编辑路径 | 旧预览及其 `link` 执行按钮消失，必须重新预览 |
| 填入 `missingDir` 后点击来源 | 真实 HTTP 返回 400、`error: "not-found"`；显示错误且不残留旧执行按钮，不要求错误文案逐字一致 |

HTTP 省略 `confirm` 或传 `false` 都只预览；客户端明确发送 `false`。`sourceDir` 优先旧字段 `traeCnDir`。重复链接的冲突可在预览中看到；面板没有 force 控件，`--force` 由 CLI 演练验证。

### 清理与验证边界

- 在测试面板移除本次创建的组并确认；若改用 CLI，必须给该 CLI 设置与测试宿主相同的 `DSH_HOME` 和 `DSH_SKILLS_NEXUS_HOME`，再执行 `remove --group trae --yes`（仅在该组存在时）。如自行执行了 Trae CN，则同样清理 `trae-cn`。先确认列表为空、源文件仍在。
- 停止测试宿主，关闭测试终端以丢弃进程级环境变量。只删除本节输出的 `fixtureRoot` 目录，以及本次专门创建的 overlay；不要删除原有 overlay、profile、`~/.trae` 或 `~/.trae-cn`。使用已有 overlay 时只停止临时 patch 进程，不删文件。
- `panel-render.test.tsx` 仅验证静态渲染；真实客户端 bundle 配合内存 HTTP / UI stub 的浏览器测试只能验证交互接线，不能替代真实宿主的组件样式、请求路由和技能发现验收。
- 本次功能开发已做隔离浏览器验证；真实宿主验收和远端 CI 矩阵不在已通过结论内。执行本指南后记录 Node/OS、各命令退出码、测试通过/跳过数，以及手工面板实际完成的项目。
