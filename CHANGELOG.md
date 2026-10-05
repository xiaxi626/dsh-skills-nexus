# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

**2026-10-05 · Changed · B2：面板原语化 + CSS Modules 布局 + `--dsw-*` 令牌主题（裁定与实现）**

- **路线裁定（B0.4）**：宿主平台源码与运行中 shell 的 boot 表互证后确定——面板走「**宿主原语做原子 + CSS Modules 做布局 + `--dsw-*` 令牌做主题**」。这不是「原语 vs 自绘」的二选一：宿主自己的客户端面板就是这个组合（同一文件既 `import { StateDot, Tag }`，又 `import css from './X.module.css'`，CSS 内全是 `var(--dsw-alias-*)`）。设计稿 §7 的「固定三色强调色 + `rgba(128,128,128,…)` 半透明灰」是平台外的自造方案，**不予实现**：它需要按主题自行维护，且不会跟随宿主换肤。§7 的**紧凑行 / 信息密度**设计意图**保留**并落在 `panel.module.css`。
- **变更**：
  - `src/client/panel.tsx`：原子替换——状态点 → `StateDot`（含 `entryState()` 的三态推导：无源/禁用为 `idle`、有更新为 `warning`、正常为 `done`）；动作按钮 → `Button`（`primary` / `outline` 区分语义，`icon` 传宿主图标）；更新徽标与状态标签 → `Tag`（`warning` / `outline` / `quiet`）；启停开关 → `Switch`（受控，`label` 提供无障碍名）；文本输入与搜索框 → `Input`（搜索带 `IconSearchOutlineRegular` 前导图标）；`pin` 内联展开 → `DisclosureRow`（受控展开，与宿主面板的折叠行为一致）；job 输出 → `TerminalBlock`（`maxLines: 6` 取代原先手写的 `slice(-6)`）；`window.confirm` → `RiskConfirmation` 受控遮罩（需勾选确认才能执行删除）。刷新按钮带 `IconRefreshOutlineRegular`，有更新的行其 update 按钮带 `IconWarningOutlineRegular`。
  - 新增 `src/client/panel.module.css`：布局、密度与间距全部走 `--dsw-*` 令牌（13 个令牌，已逐个对照宿主自身客户端包的 CSS 核验存在）。不重绘任何原语的外观。
  - `src/client/panel.tsx` 头注释重写：记录路线裁定、`PLATFORM_MODULES` 的关系，以及为什么设计稿的配色系统不落地。
  - `src/client/index.tsx`：注释记录 `settings.section`（自有独立设置行）与宿主 plugin-inventory 用的 `settings.plugins.tab`（Plugins 区内的标签页）之别，并说明后者是**信息架构**变更而非呈现变更，故不在本轮范围，避免下一个人误"修"。
- **不做**：不实现 §7 的固定色值与自绘 `<style>` 注入；不迁移 `settings.section` → `settings.plugins.tab`；不引入 `Toast`（notice 行已足够且可被静态断言）；不重绘原语内部样式（那是宿主的所有权）。
- **测试**：`test/panel-render.test.ts` 断言随原子替换调整（`pin` 由 `DisclosureRow` 承载后，静态渲染里是标题存在、输入不在）；新增 external 条目与 managed 快照的对照用例，钉住「新增的 `ownership` 字段如何改变文案与可用动作」。
- **文档**：README（中英）新增「Verifying the browser half after a change」四步——`build:client` 不在 CI 内、浏览器模块表也不被类型检查，loader 答不出的 `require` 是**运行时**抛错、构建期毫无提示，所以改 `src/client/**` 或模块表必须手跑一次并目视确认。
- **如何辨识改动**：改 `src/client/panel.tsx`（原子与 head 注释）、`src/client/index.tsx`（注释）、新增 `src/client/panel.module.css`、`test/panel-render.test.ts`、`README.md` / `README_CN.md`、`lib/client.js` 重建产物。

**2026-10-05 · Added · B1：面板补接线——健康检查 UI、搜索框、更新计数徽标、底部共存提示**

- **背景**：设计稿 §7 的四项在 `panel.tsx` 里此前**全部缺失**（§11 的「UI 现状」表把它们误标为已有）：无搜索输入、从不调用 `api.doctor()`（方法早已定义、服务端 `/doctor` 路由早已就绪、只是没有调用方）、无更新计数、无共存提示。四项都是纯前端消费既有契约，不需要任何服务端改动。
- **变更**：
  - **健康检查 UI**：工具栏下方新增 `health check` 行，`run check` 调 `api.doctor()`，以 `StateDot` + 一行摘要渲染 `summary`（`healthSummary()` 把 errors/warnings/updates 映射成「一个点的状态 + 一行文本」，错误优先于警告）。未检查时显示 `not run yet`，**不谎报健康**。
  - **搜索框**：`Input type="search"` 带宿主搜索图标，按 name / url / subdir 客户端过滤（`matchesQuery()`，大小写不敏感、空串与纯空白视为不过滤）。无匹配时给出带引号的提示行。不触碰任何状态，因此不需要新契约。
  - **更新计数徽标**：工具栏右侧 `Tag`，数量由 `entries[].update.hasUpdate` 派生（`updateCount`）；另有条目总数徽标。**不臆造数字**：计数为 0 时不渲染更新徽标。
  - **底部共存提示**：按设计稿 §10 的措辞加一行，指向 Skill Manager。
- **不做**：不做状态筛选（§11 自己判定「搜索已覆盖」）；不做「全部更新」按钮（需串行多 job，属独立设计）；不改任何 HTTP 契约。
- **测试**：`test/panel-render.test.ts` +6（搜索框存在 + `matchesQuery` 的纯函数规则、HEALTH CHECK 行与 `run check`、`healthSummary` 四态映射、空态下不出现计数徽标、`entryState` 三态、共存提示文案）。
- **如何辨识改动**：`src/client/panel.tsx`（`onDoctor` / `query` / `updateCount` / `health` 状态与渲染）、`test/panel-render.test.ts`。

**2026-10-05 · Changed · B0：客户端模块表对齐宿主九项真表、装原语类型依赖、接入 CSS Modules 通道**

- **背景**：`tsdown.config.ts` 里那张共享模块表是从第三方 vendored 副本继承的，**两个方向都错**：`@deepseek-ai/dsh-client-web-react` 与 `@deepseek-ai/dsh-client-schema-form` 在宿主里**不存在**（对整个 app.asar 做 121MB 原始字节扫描，两个字符串各 0 次命中）——按该配置自己的注释「loader 答不出的 require 必炸运行时」，这是潜伏陷阱；同时**漏了**`dsh-client-store`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`，其中 primitives 一旦被 import 就会被 `alwaysBundle` 内联，产物出现第二份宿主原语副本。
- **变更**：
  - `tsdown.config.ts`：`PLATFORM_MODULES` 改为宿主真表九项（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`store`、`ui-slots`、`ui-primitives`、`ui-dockkit`）。注释写明**双来源互证**（平台源码 `packages/client/web/src/platform.ts` 与运行中 shell boot 表里 `staticModules` 的 `rM()` 返回表逐字一致），并写明将来加表外模块的正路是 `package.json` 的 `dsh.client.external`，不是在这里硬编码更长的表。
  - `tsdown.config.ts`：新增 `dsh-css-modules-inline` 插件——`x.module.css` 经 lightningcss 以 `[hash]_[local]` 编译为**哈希类名映射 + 自注入 `<style data-plugin-css>`**，虚拟 id（`\0dsh-css:` + 绝对路径 + `.mjs`）把它挡在 tsdown 自己的 CSS 管线之外；注入前以 `document.querySelector('style[data-plugin-css=…]')` 去重，重跑不会重复插样式。`sourcePath()` 把 importer 先锚到工作目录，否则相对 specifier 会被解析成 `src/src/...`。
  - `package.json`：devDependencies 增 `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`（**装成 devDep 取类型，不再手写 `.d.ts` shim**；npm 公开发布、自带 `lib/types/index.d.ts`、`dist-tags.next` 正是运行中 shell 的版本）与 `lightningcss`。
  - 新增 `src/css-modules.d.ts`：`*.module.css` 六行声明垫片（宿主自身客户端包的范式）。
  - `tsconfig.client-types.json`：`include` 由 `**/*.ts`+`**/*.tsx` 改为 `src/client/**/*` 并补 `src/css-modules.d.ts`——`.d.ts` 垫片不是 `.ts`，旧的 glob 会静默跳过它，导致每个 `import css from './x.module.css'` 都报 TS2307（与 test tsconfig 注释里记录的是同一个坑）。
- **验收（B0.3，做完即验）**：`npm run build:client` 后 `lib/client.js` 由 39,771 B → 59,957 B，产物内含哈希类名（如 `.aqGPsq_section`）与 `data-plugin-css` 注入代码，且 `require()` 的 specifier 恰为 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 三项——**全部在九项真表内，无幽灵条目、无内联的原语副本**。另用宿主 loader 协议跑了一次握手模拟：`window.__ModuleLoader__.load({ id: 'dsh-skills-nexus', factory })` 注册成功，factory 抛错的路径证明表外 require 会被立刻发现。
- **不做**：不加 `dsh.client.external`（不需要新模块）；不把 `build:client` 接进 `build`（tsdown 要求 Node ≥22.18，CI 仍测 Node 20，与 Phase 5 的引擎决策同源）；**不改 `dsh.client.inject`**（那是宿主启动图顺序，不是运行时可 require 的表）。
- **测试基础设施**：`npm test` 现在通过 `--import ./test/register-css.mjs` 追加两个只在测试运行的 loader 钩子——`.css` 请求解析为「类名即键名」的 Proxy 模块（类名哈希是构建产物，套件从不断言它）；`@deepseek-ai/dsh-client-ui-primitives` 重定向到 `test/primitives-stub.mjs`（真包的 `lib/index.js` 顶层 import shiki / katex / micromark 全家桶，Node 里装不动——它是为浏览器打包的，而那正是本插件加载它的地方）。原语的**真实**存在性由 `npm run build:client`（按名 import，名字不存在即构建失败）与实机冒烟覆盖，两者都在本轮的核验里跑过：真包 282 个运行时导出中本面板用到的 12 个全部命中。
- **实机冒烟的诚实说明**：`desktop` profile 由 Electron 应用独占管理（`dsh plugin --profile desktop …` 直接拒绝），本会话无法在不改动用户 GUI 状态的前提下装入面板。已完成的替代核验：模块表九项逐字比对（平台源码 + 运行中 shell boot 表）、真包 12 个符号的运行时导出存在性、13 个 `--dsw-*` 令牌对照宿主自身客户端包 CSS 的存在性、以及上述 loader 握手模拟。**面板在真实宿主里的目视确认仍待用户执行一次**（见 README 的安装步骤）。
- **如何辨识改动**：`tsdown.config.ts`（表 + 插件）、`package.json` / `package-lock.json`（两个 devDep + test 脚本的 loader）、新增 `src/css-modules.d.ts`、`tsconfig.client-types.json`（include）、新增 `test/register-css.mjs` / `test/css-hook.mjs` / `test/primitives-stub.mjs`。

**2026-10-05 · Added · 面板与 `list --json` 的 `ownership` 字段（契约先行）**

- **背景**：设计稿要求 `ownership: 'external'` 的条目按专门约定展示（meta 区写 `(linked directory)` 而非 `(no source)`、不给 `[adopt]`、`[remove]` 的确认文案须说明不删目录本身）。但 `GET /list` 此前**不返回**这个字段，而 `hasGitSource` 对「无源快照」与「external 链接」同为 `false`——面板无从区分「还没有来源」与「不是它的来源」，两者需要不同的文案和不同的可用动作。
- **变更**：`src/http/routes.ts` 的 list 响应新增 `ownership: 'managed' | 'external'`（服务端 `isExternalEntry` 谓词的结果）；`src/client/api.ts` 的 `ListEntry` 同步镜像并写明语义。UI 只消费，不推导。
- **不做**：不加任何新的 HTTP 路由；不暴露 `ownership` 的写入通道（当前仍只能手工编辑 manifest 产生，属防御性展示约定）。
- **测试**：`test/api.test.ts` +1（external 条目的 `ownership` 为 `external` 且 `hasGitSource` 为 false）并补齐既有 list 用例的两处字段断言；`test/panel-render.test.ts` 新增 external 与 managed 快照的对照用例。
- **如何辨识改动**：`src/http/routes.ts`（list 响应一个字段 + import）、`src/client/api.ts`（`ListEntry.ownership`）、`test/api.test.ts`、`test/panel-render.test.ts`、`lib/` 重建产物。

**2026-10-05 · Added · CLI 写操作机器接口：`list` / `add` / `update` / `remove` / `enable` / `disable` 的 `--json`（version 1）**

- **背景**：`build-on-nexus.md` 此前把写侧机器输出列为「明确不存在」，只提供 `list --names` 与 `doctor --json` 两条只读通道，外部工具（CI、第三方 GUI、sync daemon）只能靠退出码 + 事后重查状态驱动写操作，无法知道「刚才装到了哪个 commit」。P0 计划把写侧补齐为与 `doctor --json` 同级的稳定契约。
- **变更**：
  - 新增 `src/cli/json-types.ts`：version 1 报告契约（`ListJsonReport` / `AddJsonReport` / `UpdateJsonReport` / `RemoveJsonReport` / `ToggleJsonReport` / `JsonError`）。每个报告的 `version: 1` 是字面量类型，破坏性变更必须逐个构造点显式改动，不会在类型重构里被悄悄漏掉。
  - 新增 `src/cli/json-io.ts`：第三个 `OpsIO` 实现（继 `cliIO` / `jobIO`·`quietIO` 之后）。`emit`/`progress` 为 no-op（stdout 只留报告本身）、`error` 委托上层通道（诊断仍进 stderr，且不属契约）、`spin` 内联执行、`confirm` 返回默认值、`interactive: false`。另含 `emitJson`（2-space + 末尾换行）与 `fatalJsonError`（`{ version, error: { message } }` 写 stderr）。
  - `src/cli/args.ts`：`parseAddArgs` / `parseRemoveArgs` / `parseListArgs` 增 `json`；新增 `parseUpdateArgs`（`update` 此前用 `positional()` 且完全不解析 flag，`update --json` 会被静默丢弃）与 `parseToggleArgs`（多 positional）。全部拒绝 `--json=value`；`list` 的 `--names` 与 `--json` 互斥。
  - `src/cli/commands/{list,add,update,remove,toggle}.ts`：各自的 `--json` 分支。`addOne` 透出 `GitInstallResult` 的 `entry.commit` / `ref` / `links` / `code`（新增字段全可选，人类路径只读 `status`）；`update` 每项记录 `fromCommit` / `toCommit` / `status`；`remove` 收集 per-name 结果与删除的链接；`toggleLinks` 返回 `linksChanged` 并把批量结果收敛进报告。
  - `src/cli/usage.ts`（新增）：帮助文本与其打印器从 `index.ts` 抽出。`index.ts` 是可执行模块（import 即跑 `main()`），抽出来测试才能读它；`test/completions.test.ts` 的 flag 漂移守卫随之从「正则抓函数体」改为「读常量 + 跑打印器比对」，不再因等价重构误报。
  - 四份补全模板（bash/zsh/fish/powershell）为六个命令补 `--json`，并保留「不得为 `update`/`enable`/`disable` 提供 `--yes`」的守卫（`update` 现在解析 flag，误报的 `--yes` 会从静默无操作升级为用法错误）。
  - 文档：`docs/build-on-nexus.md` 从「接口两条」改为四条，新增「The `--json` write interface (version 1)」整节（承诺项 / 非承诺项 / 不提示语义 / 五份报告样例 / 错误形态），并把「No write-side machine output」「No `list --json` (yet)」两条从「明确不存在」段移出。
- **不做**：不给 `export` / `import` / `adopt` / `switch-version` 加 `--json`（package 格式与长任务状态机，留 P1；job 结构化状态属 HTTP 通道）；不做 JSON 流式/增量输出；`manifest.json` schema 不变；HTTP 路由与面板本轮零触碰。
- **契约**：顶层 `version: 1`；2-space 缩进 + 末尾换行；退出码 `0` 成功 / `1` 有错误或部分失败 / `2` 用法错误；`--json` 下 stdout 只含报告，诊断走 stderr；`--json` 运行 `interactive: false`，需确认的步骤（wrapped repo、大集合、多匹配 glob）一律拒绝而非确认，文档要求「`--json` 须传 `--yes`」。
- **测试**：新增 **51 条**（3 个新文件均已加入 `package.json` 的 `test` 显式列表——该脚本不是 glob，不加就静默不执行）。`npm test`：569 通过 · 0 失败 · 3 跳过（= 基线 518 + 51）。
  - `test/json-io.test.ts`（12）：`emit`/`progress` 静默、`error` 委托与无 fallback 时不抛、`confirm` 不抛 `NeedsConfirm`（对照 HTTP half）、`spin` 内联与透传拒绝、`emitJson` 框架与 `JSON.parse` 往返、`fatalJsonError` 只写 stderr。
  - `test/toggle-json.test.ts`（9）：报告形状与 count、多 link 的 `linksChanged`、幂等的 `already: true`、未知名的 per-item `not-found` 且 exit 1、批量按参数序独立处理且不因中途失败停摆、用法错误的 JSON/人类两种方言、缺名提示带命令名。
  - `test/add-update-json.test.ts`（12）：`add` 的 commit/links、stdout 纯净（无 Cloning/Added skill 文本）、单项失败隔离并继续、重复注册的拒绝文案、多 spec + `--name` 的 exit 2、`--json=false` 的 exit 2；`update` 的 up-to-date 同 commit、before→after 对、未知目标 exit 1、空 manifest 空报告、`--json=1` 与双 positional 用法错误。
  - `test/args.test.ts` +14 条 `parseUpdateArgs` / `parseToggleArgs` 用例与 `--json` 内联值、`--names`×`--json` 互斥；`test/list.test.ts` +5 条 `list --json` 用例（含机器方言的用法错误）；`test/completions.test.ts` 的模板守卫拆为「`--yes` 不得出现在拒绝它的命令上」。
- **验证方式**：六步门禁（`typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test`）。
- **如何辨识改动**：新增 `src/cli/json-io.ts` / `src/cli/json-types.ts` / `src/cli/usage.ts`；改 `src/cli/args.ts`、`src/cli/index.ts`、`src/cli/commands/{list,add,update,remove,toggle,doctor,export,import,adopt,switch-version,completions}.ts`、四份 `src/cli/commands/completions/*.ts`、`package.json`（`test` 列表）、`docs/build-on-nexus.md`、`README.md` / `README_CN.md`、`lib/` 重建产物。

**2026-10-05 · Changed · A1：CLI 诊断通道收编进 OpsIO（`io.error`），`printHelp` 改经 `io.emit`**

- **背景**：`routes.ts:19-20` 在案的最后一项——7 个命令已接 `io` 参数，但约 40 处 `process.stderr.write` 仍绕过接缝直接写进程流，`printHelp` 也仍直接写 stdout。多 host half 共用 CLI 入口的前置条件就是「前端只有一个出口」。
- **变更**：
  - `src/ops-io.ts`：`OpsIO` 新增**必需**成员 `error(line)`（与 `emit` 同款「缺换行则补」语义）。设为必需而非可选：诊断静默丢失是看不见的退化，编译器应当拦住。`cliIO.error` 委托 stderr。
  - `src/http/io.ts`：`jobIO.error` 把诊断推进 job 的 `output`（面板唯一可轮询的通道，写 stderr 等于消失在服务端日志里）；`quietIO.error` 为 no-op（同步路由的失败是错误信封，由抛出的值构造）。
  - 收编 `src/cli/index.ts`（未知命令 + 顶层 fatal 的注释说明为何刻意保留裸 stderr）与 11 个命令文件的全部 `process.stderr.write`。
  - `src/cli/usage.ts`：`HELP_TEXT` 常量 + `printHelp(io)`，帮助文本字节不变（`HELP_TEXT` 已带末尾换行，`cliIO.emit` 不再补）。
  - `test/completions.test.ts`：flag 漂移守卫改为读 `HELP_TEXT` 并把 `printHelp` 跑进假 OpsIO 比对，不再 scrape 函数体；子命令守卫优先读 `src/cli/index.ts` 的 `case` 标签，编译产物运行（无 `.ts` 可读）时回退到 `ROUTED_SUBCOMMANDS` 并断言两者一致。
- **不做**：不改 `src/http/routes.ts` 的 `[plugin] route error` 服务端日志（不是 CLI 输出）；不改 `src/install.ts` 的既有诊断（`add` 透传 `io` 后已随接缝走）；不改人类输出任何一个字节。
- **测试**：`test/ops-io.test.ts` / `test/completions.test.ts` / 各命令测试的 `OpsIO` 替身同步补 `error`；`test/adopt.test.ts` / `test/import.test.ts` / `test/export.test.ts` 的 `captureIO()` 拆出 `errors[]`（A1 的要点就是机器读一条流、人读另一条）。
- **验证方式**：既有输出字节等价；六步门禁全 0。
- **如何辨识改动**：改 `src/ops-io.ts`（接口 + `cliIO.error`）、`src/http/io.ts`、`src/cli/usage.ts`（新增）、`src/cli/index.ts` 与全部命令文件、`test/` 的 `OpsIO` 替身、`lib/` 重建产物。

**2026-10-05 · Added · A3：`enable` / `disable` 接受多个名字，与 `remove` 对称**

- **背景**：`positional()` 早已就位、`remove` 早已支持多 token，但 `toggle` 只取第一个位置参数，多给的名字被静默丢弃——同一批技能启停只能逐个敲命令。
- **变更**：`parseToggleArgs` 收集全部 positional，`toggle` 对每个名字独立处理（未注册 = per-item 失败，不中断其余），退出码沿用「有任一失败即 1」。`linksChanged` 与 per-name 结果同时供人类路径与 `--json` 报告使用（`toggleLinks` 由「返回退出码」改为「返回链接增删数」）。缺名提示保留 `<name>...` 形态并带上命令名。
- **不做**：不改 HTTP `/toggle` 路由（其 `names: string[]` 扩展属独立契约变更，本轮 UI 轨道未消费）；不加 `--yes` 之类的确认门（启停非破坏性）。
- **测试**：`test/args.test.ts` 的 `parseToggleArgs` 用例（多名字、`--json` 位置无关、缺名、内联值拒绝、命令名进提示）；`test/toggle-json.test.ts` 两条批量用例断言「逐项独立 + 顺序 + 部分失败仍继续」。
- **如何辨识改动**：`src/cli/args.ts`（`parseToggleArgs`）、`src/cli/commands/toggle.ts`（批量循环 + `toggleLinks` 返回计数）。

**2026-10-05 · Fixed · Windows 上 NTFS junction 对 `lstat`/`readlink`/`unlink` 不可见，导致链接归属、`disable`、`doctor` 与 `list` 全部失效**

- **背景**：`linkSkill` 在 Windows 上创建 junction（真目录符号链接需要 junction 不需要的权限）。实测（Node 24.19.0 / Windows）：`lstat(junction).isSymbolicLink()` 为 **false**（报 `S_IFDIR`）、`readlink(junction)` 抛 `EINVAL`、`unlink(junction)` 抛 `EPERM`；只有 `realpath` 能正确解析、`rmdir` 能正确删除且不进入目标。因此 `src/link.ts` 与 `src/health.ts` 里成对的 `lstat` + `readlink` 判据把每个 junction 都当成「普通目录」跳过——链接着的条目标成 disabled、`disable` 静默删 0 个链接、裸 `update` 跳过它、`doctor` 的 symlinks/orphan-link 两项看不见它。
- **变更**：
  - `src/paths.ts`：新增 `resolveLinkTarget(linkPath)`（`realpath`，失败返回 `undefined`），作为读链接目标的唯一入口。
  - `src/link.ts`：`entryLinks` / `readLinkTarget` / `hasCollision` / `unlinkSkill` / `unlinkIfPointsInto` 一律改走它；删除改走新的 `removeLinkEntry`（先 `rmdir`，失败再 `unlink`），因为 junction 是目录、`unlink` 拿不下；新增 `isLinkAt` / `readLinkEntryTarget` 供 health 复用，`readLinkEntryTarget` 在 `realpath` 失败时回退 `readlink`（悬空 POSIX 符号链接仍可读出目标）。
  - `src/health.ts`：`diagnoseEntry` 与 `findOrphanLinks` 改用同一对读入口，`unreadable-link` 保持原义（目标无法恢复），悬空链接现在能正确落到 `dangling-link`。
  - **平台边界（写入「不做」）**：Windows 无法为「目标不存在的 junction」建档（`symlink(..., 'junction')` 直接 `ENOENT`），也无法把「目标被删除后的 junction」判为链接（`realpath`/`readlink` 双双拒绝、`lstat` 报普通目录）。因此凡是要求分类**悬空**链接的断言在 Windows 上自跳过（`test/fs-helpers.ts` 的 `DANGLING_LINKS_OBSERVABLE` 实测探针），POSIX 上照常执行。删除路径不受影响：`rmdir` 在所有平台都能删掉它。
- **不做**：不动 `git.ts` 的 `isRealDirectory`（其 `lstat` 语义本身就要求「不是链接」）；不引入平台分支模拟 junction 语义。
- **测试**：`test/link.test.ts` 的断言从「`lstat` 报 symlink」改为「解析到目标目录」（可移植且真正想断言的东西），补 `linkSkill` 换绑、`unlinkSkill` 幂等、`hasCollision` 的实目录/链接区分；`test/health.test.ts` / `test/doctor.test.ts` 的悬空分类用例加实测跳过标记；新增 `test/fs-helpers.ts`（`removeTree` 先清悬空链接再 `rm`——`rm -r` 删不掉悬空 junction 会报 `ENOTEMPTY` 并把链接留在原地）。
- **验证方式**：`test/link.test.ts` 7/7 通过（修复前 3 条红）；`test/health.test.ts` 14 通过 · 3 按平台跳过；`test/doctor.test.ts` 21 通过 · 3 按平台跳过。
- **如何辨识改动**：改 `src/paths.ts`（`resolveLinkTarget`）、`src/link.ts`（读/删原语 + 新导出）、`src/health.ts`（两处读链接）；新增 `test/fs-helpers.ts`；改 `test/link.test.ts` / `test/health.test.ts` / `test/doctor.test.ts` / `test/adopt.test.ts`。

**2026-10-04 · Docs · 帮助文本与文档声明多平台 git 仓库支持，标注 `owner/repo` 简写仅限 GitHub**

- **背景**：底层 git 操作（clone / ls-remote / sparse-checkout / fetch / pull）全部通过系统 `git` 命令、URL scheme 白名单不限主机，早已平台无关；但帮助文本、README、JSDoc 全部只展示 GitHub 示例，`owner/repo` 简写的 GitHub 硬编码也未在文档中说明。
- **变更**：
  - `src/cli/index.ts`：帮助文本 tagline `GitHub` → `git`；usage 行 `<github:owner/repo[#ref]>` → `<repo-spec>`；Accepted forms 补 GitLab / Gitee 示例，标注 `owner/repo` 与 `github:` 前缀为 GitHub 专有。
  - `src/git.ts`：`parseGitSpec` JSDoc 补 GitLab / SSH 示例，标注 `owner/repo` 仅限 GitHub。
  - `src/cli/commands/add.ts`：模块注释 `GitHub` → `git`。
  - `package.json`：description `GitHub` → `git`。
  - `README.md` / `README_CN.md`：项目描述、usage 示例、accepted forms 段、tool builders 段同步改为多平台表述，补 GitLab 示例，标注 `owner/repo` 简写限制。
  - `docs/sources-and-packages.md` / `zh-CN`：Channel A 示例补 GitLab 行。
- **不做**：不改 `parseGitSpec` 代码逻辑（`owner/repo` 仍硬编码 GitHub，功能上无需动）；不引入 `gitlab:` 前缀简写（可选增强，另行处理）。
- **验证方式**：`npm run build` 重建 `lib/` 产物；`node --import tsx --test test/completions.test.ts` 21 pass / 3 skip；`node --import tsx --test test/git.test.ts test/cli-plugin-parity.test.ts` 62 pass。
- **如何辨识改动**：`src/cli/index.ts`（帮助文本）、`src/git.ts`（JSDoc）、`src/cli/commands/add.ts`（注释）、`package.json`（description）、`README.md` / `README_CN.md`、`docs/sources-and-packages.md` / `zh-CN`、`lib/` 重建产物。

## [0.5.0] - 2026-10-04

**2026-10-04 · Fixed · 面板 export 失败不再只显示裸码 `400 export-failed`，改为展示服务端人话消息**

- **背景**：manifest 为空时点「export all」，`exportSkills` 抛 `ExportError('the manifest holds no entries to export')`，路由映射为 `400 export-failed` 并把原文放进 `data.message`。但面板 `errorText` 没有 `export-failed` 分支，落入 default 的 `${status} ${error}`，用户只看到裸码、不知道发生了什么。
- **变更**：`src/client/panel.tsx` 的 `errorText` 新增 `case 'export-failed'`：优先返回 `data.message`（服务端原文），缺失时回退 `the export failed — refresh and try again`。
- **不做**：按钮位置与空列表禁用（属 UI 改版范畴，另行处理）。
- **测试**：`test/panel-render.test.ts` +1：带 message 时原样透出；不带 message 时回退文案且不含裸码。
- **验证方式**：六步门禁全 0。`npm test`：518 通过 · 0 失败 · 3 跳过（+1 吻合）。
- **如何辨识改动**：`src/client/panel.tsx`（errorText 一个 case）、`test/panel-render.test.ts`（一条纯映射测试）、`lib/` 重建产物。

**2026-10-03 · Added · export 面板化：同步 POST /export 路由 + 面板「export all」按钮，路径以可复制 notice 展示**

- **背景**：export 是 CLI 已有、面板缺失的最后一个通道（channel C）。第 3 轮探针已证实 host 能原样透传 Buffer / 大响应，内容类型不被改写——export 面板化没有 transport 障碍。设计按 assessment §4.5 的保守形态：路径文本，不做下载按钮。
- **变更**：
  - `src/http/types.ts`：`RouteResponse.end` 的 `body` 参数从 `string` 放宽为 `string | Buffer`（镜像类型对齐 Node 原生 ServerResponse；探针已验证 host 行为）。
  - `src/http/routes.ts`：新增 `POST /export`（同步、loopback、same-origin）。接受 `{ names?: string[], all?: boolean }`，把 zip 写到 `<NEXUS_HOME>/exports/`（按 CLI 同名默认），返回 `200 { data: ExportResult, hotReload: 'done' }`。`ExportError` 映射为 `400 export-failed`。zip 内容不包含 `.git`，不携带凭证。
  - `src/client/api.ts`：`NexusApi` 新增 `export(body: ExportBody): Promise<Envelope<ExportResult>>`；新增 `ExportResult` / `ExportBody` 类型。
  - `src/client/panel.tsx`：底部操作行新增「export all」按钮（`exportBusy` 态）。成功后以 notice 展示服务端正路径（可复制）+ `skipped[]` 逐条 ⚠ 说明。
  - `docs/sources-and-packages.md` / `zh-CN`：Panel mirror 表 export 行从「CLI only」改为面板位置说明。
- **不做**：不做下载按钮（§4.4：路径文本是当前形态）；不做 `POST /export` 的 `confirm` 门（只读核心，zip 是唯一写入）；不做 per-entry export（`--all` 是唯一按钮，选中导出留给 CLI）。
- **测试**：新增 **10 条**。`test/api.test.ts` +8：
  - 405 拒绝 GET
  - 403 拒绝跨 origin
  - 403 拒绝非 loopback
  - 400 `export-failed` 空 manifest
  - 200 全量导出两条目为 zip（文件落盘验证）
  - 200 全量导出跳过 external 条目并记录 skipped
  - 400 按名导出未知 skill
  - 200 按名导出单条目 zip
  `test/client-api.test.ts` +1：export 请求形状（POST JSON `{ all: true }`）。
  `test/panel-render.test.ts` +1：export-all 按钮在静态标记中。
- **验证方式**：六步门禁全 0。`npm test`：517 通过 · 0 失败 · 3 跳过（+10 吻合）。
- **如何辨识改动**：改 `src/http/types.ts`（end 类型放宽）、`src/http/routes.ts`（exportRoute + 注册）、`src/client/api.ts`（ExportBody / ExportResult / export 方法）、`src/client/panel.tsx`（exportBusy state + onExport handler + 按钮）、`test/{api,client-api,panel-render}.test.ts`、`README.md` / `README_CN.md`（面板能力清单 + POST 路由列表）、`docs/sources-and-packages.md` / `zh-CN`（Panel mirror 表）、`lib/` 重建产物。

**2026-10-03 · Added · adopt 行补 subdir 输入与备份路径 notice；errorText 补「改用 CLI 加 `--force`」兜底文案；CLI↔路由同形测试扩 --name 用例并断言 path 与 name 解耦**

- **背景**：面板 adopt 缺少 subdir 字段（路由与 `AdoptBody` 契约早已支持），备份路径只在 job 输出的一行字里，用户错过就找不到旧目录；`skill-mismatch` 与 `already-has-source` 两个 409 在面板没有逃生通道（面板结构性不可达 `--force`），只能让用户回 CLI。
- **变更**：
  - `src/client/panel.tsx`：
    - `errorText` 新增 `already-has-source`（面板按钮只在无 git 源条目上出现，409 属 race / stale-list）与 `skill-mismatch` 两条文案，均指向「改用 CLI 加 `--force`」。函数改为导出，便于纯映射单测。
    - `track` 对 `done` job 调用 `adoptBackupNotice`，从 job 输出中提取 `previous directory kept as <path>` 这一行并提升为面板 notice；文案对齐 CLI 的建议（`delete it once this source looks right; doctor lists it until then`）。
    - adopt 区域加 `subdir` 输入行，placeholder 为 `optional, e.g. skills/foo`；成功后 url 与 subdir 两输入同时复位。新增 `adoptSubdirInputs` state，不动 `api` 惰性初始化。
    - `EntryCard` 新增 `adoptSubdirValue` / `onAdoptSubdirChange` props，调用点同步传递。
  - `test/cli-plugin-parity.test.ts`：既有 add 同形骨架加入 `--name`（CLI）与 `name`（路由），并新增 4 条断言：
    - `path` 不包含名字（`doesNotMatch(/named-cli/)` / `doesNotMatch(/named-api/)`）
    - `path` 仍是 repo slug（`match(/src-add-cli/)` / `match(/src-add-api/)`）
    - 链接名不受 name 影响（仍然是 alpha-add-cli / beta-add-cli）
- **不做**：不为 adopt 加 `ref` / `force` / `prune` 控件（超出范围）；不开始 export 面板化（先探针 host 二进制透传）；不处理 lint unused-directive warning（独立遗留）。
- **测试**：`test/panel-render.test.ts` +4：
  - adopt subdir 输入在静态标记中且值回环
  - errorText 对 `skill-mismatch` / `already-has-source` 均包含 `--force`
  - `adoptBackupNotice` 能从 job 输出中提取路径并转化为 notice
  - `cli-plugin-parity` 改写既有用例，新增 4 条 path/name 解耦断言。
- **验证方式**：本轮门禁 `typecheck` / `lint`（0 error；既有 warning）/ `test:build` / `build` / `build:client` / `npm test`（507 通过 · 0 失败 · 3 跳过）退出码全 0。
- **如何辨识改动**：改 `src/client/panel.tsx`（errorText / adoptBackupNotice / EntryCard props / adopt subdir 输入 + 复位）、`test/panel-render.test.ts`（+4 条）、`test/cli-plugin-parity.test.ts`（--name + path 断言）、`docs/sources-and-packages.md` / `zh-CN`（Panel mirror 表 adopt 与 export 行）与 `lib/` 重建产物。

**2026-10-03 · Added · 面板 `add` 表单补齐 CLI 已有的三个输入通道：`name`（条目名覆盖）/ `ref` / `subdir`；注册名按 CLI 的 `??` 链重算，clone 目录不跟随名字**

- **背景**：`docs/panel-field-coverage-assessment.zh-CN.md` 的核查确认面板 add 只发 `{ url, confirm: true }`，而 CLI add 早有 `--name` / `--ref` / `--subdir`；更关键的是路由在 preflight 里按 `sanitizeName(subdirLeaf ?? repoBase)` 推导注册名，与 CLI 的 `sanitizeName(name ?? subdirLeaf ?? repoBase)`（`src/cli/commands/add.ts`）在同一个函数上分叉——面板用户给 monorepo 子目录取短名、指定分支或子目次都只能回 CLI。原方案以为 `AddBody` 字段齐全、只需把 `installFromGit` 的 `name: undefined` 改成读 body；核实后两点都不成立：`AddBody` 没有 `name` 字段，而 `installFromGit` 的 `name` 入参只用于一行中文提示、根本不参与命名，改它等于没改。
- **变更**：
  - `src/http/routes.ts` 的 add preflight：`const explicitName = strField(body, 'name')` 后按 `sanitizeName(explicitName ?? subdirLeaf ?? repoBase)` 重算 `skillName`——与 CLI `src/cli/commands/add.ts` 的同一条 `??` 链。`path` 刻意不进这条链（仍是 `repoBase` 或 `repoBase-subdirLeaf`）：名字覆盖不改 clone 目录，同一仓库经 CLI 装与经面板装共享 `repos/` 下一个目录。`already-registered` / `collision` 两个 preflight 409 用的都是重算后的 `skillName`，自动覆盖新名字。
  - 调用 `installFromGit` 时 **`name: undefined` 保持不变**：该入参在 `src/install.ts` 里只承载一行「`--name` 与默认条目名相同」的中文提示，传值会让这行中文泄漏进 Web job 日志且不改变任何命名。
  - `src/client/api.ts`：`AddBody` 新增 `name?: string`（条目名覆盖的契约通道）。
  - `src/client/panel.tsx`：add 表单在 url 行下新增默认收起的 `<details>` 折叠区（summary：`optional: name / ref / subdir`），含三个输入；ref 的 placeholder 写死优先级说明 `branch/tag (a #ref in the url wins)`（url 中 `#ref` 覆盖输入框是 `parseGitSpec` 的既有行为）；add 成功后 url 与 name / ref / subdir 全部复位、折叠区收起，避免收起值静默套用到下一次 add。`api` 实例的惰性 `useState` 初始化未动，render-stable 约束保持。
- **不做**：不做 P2 import 面板扩展（面板无 mid-job 交互通道）；不做评估文档 §7 的 `§N` 引用清理（独立任务）；adopt 的 subdir 输入、备份 notice 与 `--force` 兜底文案是下一轮 P0-2 / P1；不开始 export 面板化（先做 host 二进制探针）；不在面板复刻 `--force`；add 的 `confirm: true` 是面板有意设定，不动。
- **测试**：新增 **4 条**。`test/api.test.ts` +2：显式 name 经 preflight 409 固定重算结果（旧链下 repo slug 不冲突会走到 202）、两个不同来源共享同一显式 name 时因名字碰撞回 409（两条 clone path 不同，固定「同名不得注册第二条」）；`test/client-api.test.ts` +1：未提供的可选字段不进 JSON 体（另把既有请求形状用例扩为 name / ref / subdir 全字段）；`test/panel-render.test.ts` +1：折叠区默认收起但三个输入与 ref 优先级 placeholder 在静态标记中。
- **验证方式**：本轮门禁 `npm run typecheck`（tsc strict）/ `npm run lint`（0 error；一条 unused-directive warning 在干净 HEAD 已存在）/ `npm test` 退出码全 0；`npm run build` 与 `npm run build:client` 重建入库产物（`lib/`、`lib/client.js` 与 `lib/client-types/`）。面板无自动化点击测试，未引入 jsdom 等新依赖：折叠区由 `react-dom/server` 静态渲染断言，请求形状与路由契约分别由 client-api / api 测试覆盖。
- **如何辨识改动**：改 `src/http/routes.ts`（skillName 重算 + 注释；`name: undefined` 原样）、`src/client/api.ts`（`AddBody.name`）、`src/client/panel.tsx`（state + onAdd 载荷/复位 + details 折叠区）、`test/{api,client-api,panel-render}.test.ts`、`README.md` / `README_CN.md`（面板能力清单）与相应 `lib/` 重建产物，以及本 CHANGELOG。
- **已知遗留（暂不处理）**：`npm run lint` 在 `src/client/panel.tsx:40` 报一条 `Unused eslint-disable directive` warning（`@typescript-eslint/no-unused-vars`）。该 disable 是为 `import React` 写的防御性抑制，但现行规则配置下该违规不会触发，ESLint 9 的 `reportUnusedDisableDirectives` 因此抓出它。**在干净 HEAD（e5598f5）上复现一致，属基线既有问题、非本轮引入**；修法是删掉那条指令并复验 `no-unused-vars` 确实不报（React 导入本身仍被 classic JSX runtime 需要，不能删）。经讨论确认暂不处理，留作独立小改动。

**2026-10-03 · Fixed · `dsh plugin --profile web add "github:…"` 装不上：host peer 范围 `*` 改为 `>=0.1.0-rc.6`，修掉 pnpm 对预发布版本的范围推导死路（`ERR_PNPM_NO_MATCHING_VERSION @ >=0.1.0`）**

- **背景**：0.4.0 之后的 c66ee20（Phase 2 http routes）给包加了 optional peer `@deepseek-ai/dsh-host-webserver: "*"`（v0.3.0 / v0.4.0 两个 tag 里没有 peerDependencies，所以当时安装正常）。`dsh plugin add` 只是在 profile 目录转发 `pnpm add`：当 profile 依赖图里**已存在**该 peer 的预发布实例（web profile 的 `dsh-research@0.4.3` 经 `autoInstallPeers` 拉入 host `0.1.0-rc.8`，其自身 peer 是 `>=0.1.0-rc.6`），pnpm 11.16 面对 `*` 会按现有实例合成复用范围 `>=0.1.0`——丢掉预发布后缀。按 semver 规则，不含预发布比较符的范围**不匹配任何 `-rc`/`-alpha` 版本**，而该包 registry 的 `latest` 停在 `0.0.1-rc.1`、0.1.x/0.2.x 全部是预发布，于是范围一个版本都匹配不到，安装在解析阶段（代码尚未下载）即失败。**不是新版 dsh harness 变严**：0.1.5-rc.3 与 0.2.0-rc.2 两版的插件转发逻辑相同；CLI 全局安装（npm 跳过顶层包 peer 自动安装，optional peer 缺失合法）与 `dsh web --patch overlay.yml`（运行时按路径直接挂载，完全不经过 pnpm/registry）都不走这条解析路径，因此一直正常——只有"profile 图里已有预发布 host + git 规格装本包"二者叠加才触发。
- **变更**：
  - `package.json` 的 `peerDependencies."@deepseek-ai/dsh-host-webserver"` 由 `"*"` 改为 `">=0.1.0-rc.6"`——范围带预发布比较符后，semver 允许匹配 `-rc` 版本，pnpm 直接复用图中已有的 host 实例，不再合成坏范围。取值与 `dsh-research` 的 peer 声明对齐；该范围天然兼容 0.2.x 预发布（实测 `0.2.0-rc.2` 同样复用成功），不需要写并集。
  - `package-lock.json` 根条目（`packages[""]`）的同一字段同步；`peerDependenciesMeta.optional: true` 保留不动——host 仍是 optional peer，空图里缺失照旧合法。
  - 代码零改动：host 本就是反射式使用（`ctx.inject(['webServer'])`，`src/http/types.ts` 只镜像结构类型、从不 import host 包），不存在需要跟随的 API 面。
- **不做**：不升 `package.json` 版本号（按本仓库惯例，版本号与 tag 由单独的 `chore(release)` 提交处理，本轮留在 Unreleased）；不在用户 profile 的 `pnpm-workspace.yaml` 里钉 `overrides`（那是逐机器、钉死 rc.8 的临时补丁，仓库侧修范围才是根治；修复推送、锁文件刷新后该 override 可删）；不动结尾 `allowBuilds` 相关任何东西——dsh 对任何带 `github:` 的 pnpm 失败都固定打那段构建许可提示，本包没有 `prepare` 脚本，提示与本次失败无关；不碰 `--patch` 挂载链路（它不经包解析，无需修复）。
- **验证**：
  - **复现与对照（全新临时目录，pnpm 11.16）**：先装 `dsh-research@0.4.3` 再以 `github:xiaxi626/dsh-skills-nexus` 安装 → 稳定复现 `ERR_PNPM_NO_MATCHING_VERSION @ >=0.1.0`；空目录（图里无 host）安装成功；本地 `file:` 路径依赖成功而 git 系规格失败——确认触发点是 gitFetcher 路径下的 peer 范围解析，而非装载或构建。
  - **兼容矩阵**：两种 host 图（`0.1.0-rc.8`、`0.2.0-rc.2`）× 三种 peer 范围（`*` / `>=0.1.0-rc.6` / 并集），用含提交的本地 git 仓库走 `git+file://` 规格（与 `github:` 同一 gitFetcher）：修复范围在两种图下均成功，锁文件中 host 始终是单一实例。
  - **真实 profile 端到端**（`docs/verify-plugin-install.zh-CN.md` 流程，写入真实 `~/.dsh/profiles/web/`）：质量门禁 `typecheck` / `lint`（0 error）/ `build` / `npm test`（**503 条 · 500 通过 · 0 失败 · 3 跳过**）全绿；`file:` 与 `git+file://` 两种规格 `dsh plugin add` 均 `exit=0`，reconcile 把 `dsh-skills-nexus` 追加进 `dsh.profile.bundles`；`dsh web` 冷启动无 loader 错误，`GET /skills-nexus/ping` 返回 **200** 与插件 JSON 信封；`dsh plugin remove` 后 profile 恢复为五个基础 bundle、锁文件无残留（冷启动用 `--port 0` 避让机器上已在运行的 3080 会话）。
  - **待办（非代码）**：`github:` 拉的是远端 HEAD，真实 `github:` 复验需在本提交推送后按验证文档「推送后的真实 github: 复验」一节补跑。
- **如何辨识改动**：改 `package.json`（1 行 peer 范围）、`package-lock.json`（根条目同步 1 行），以及本 CHANGELOG；无 `src/`、无测试、无 `lib/` 产物变更。

**2026-10-02 · Added · 面板入口：`import`（裸 body 上传 → 同步 dry-run 预览 → 确认后 202 任务）与 `adopt`（条目行内 attach source）**

- **背景**：设计稿 `docs/sources-and-packages.md` §10.3 要求面板与 CLI 同构——`import` 复用今天 `add-zip` 那一行（选文件 → `--dry-run` 预览 → 确认导入），`adopt` 是条目行内动作、**仅在无 git 源条目上出现**。S5 退役 zip 时把那一行留了空，本轮把它补上，并且两侧都调用 §10.1 的共享核心（`src/import.ts` / `src/adopt.ts`），不新增第三份实现。
- **变更**：
  - **上传通道决策（乙：裸 body）**：S5 删掉手写 multipart 解析器之后，这里没有恢复它。`POST /skills-nexus/import` 直接读 **raw body**，文件名走 `x-nexus-filename` 头（或 `?name=`），选项走查询串。理由是单文件整传根本不需要解析器：`fetch(body: file)` 原样发字节，没有 boundary 扫描、没有头解析，路由就只是 `readBody` 的一层薄壳（上限 `MAX_PACKAGE_BYTES = 200MB`，即 §5 的量级，随通道一起回来；包自身的静态规则与体积上限仍由 `readZip` 把关）。**这是 §10.3 面板入口的传输选择，不是新增安装档位。**
  - **`stagePackage` 只吃路径**，所以 body 先落盘：`stageUpload` 用 `mkdtemp(NEXUS_HOME/upload-)` 建临时**目录**、文件按上传原名写进去，`finally` 里整目录删除（预览与正式两条路径都删）。目录负责唯一性、文件名保持原样，是因为**无标签包会按文件名推导条目名**——内部命名会把条目注册成 `upload-…-1730000000`（这条是测试逼出来的，见下）。
  - **两种形态、一条路由**：`?dryRun=true` 同步 `200 { data: { plan } }`（`ImportPlan` 是纯数据：四态判定、候选根、剥壳层数、文件数），零副作用、不占 flight；`?confirm=true` 走 `accept(res,'import',…)` → **202 任务**，缺 `confirm` 答 **409 confirm-required**（`--force` 替换已注册条目只在带确认时生效）。两次调用重复上传同一份字节（浏览器持有 `File`；另一条路是服务端暂存 + token，那要多一份会过期的状态，为一个刚选过的文件不值当，已在注释里写明）。
  - **`POST /skills-nexus/adopt`** → **202 任务**：`{ name, url, ref?, subdir?, force?, prune?, confirm? }`，`url` 必填且**绝不猜测**。**关键差异**：`adopt` 是任务，任务里抛的错只能落进 job 记录（面板就丢掉了 §10.4 的码，只能显示一段生消息）。因此把核心的三个只读守卫抽成 `adopt.ts` 的 `assertAdoptable(name, url, ref)`，**路由在 202 之前先跑同一个守卫**（`adoptSkill` 内部也调它，不是第二份拷贝），于是 `404 skill-not-found` / `409 external-entry` / `400 invalid-url` 都在线路上。状态映射表：`not-found`→404；`already-has-source`/`external-entry`/`skill-mismatch`/`collision`→409；其余（`invalid-url`/`invalid-subdir`/`no-skill-found`/`not-a-directory`/`clone-failed`/`adopt-failed`）→400。`import` 的 `ImportError` 映射：`already-registered`/`collision`/`install-refused`→409，其余→400（新路由仍要过 `requireMutationSafe`，跨源一律 403）。
  - **措辞只有一份**：四态判定文本抽到新模块 **`src/import-decision.ts`**（纯函数、零依赖，所以浏览器半边能引），`src/cli/commands/import.ts` 的 `--dry-run` 与面板预览都调 `describeDecision`；`src/import.ts` 原样再导出这两个类型，导入面不变。**不在面板里另写一套措辞**——`src/import.ts` 会把 `node:fs`/`node:child_process`/zip 编解码器拖进浏览器 bundle，这正是它单独成模块的原因。
  - `src/http/jobs.ts` 与 `src/client/api.ts` 的 `JobKind` 各加 `'import'`/`'adopt'`；`ApiFetchInit.body` 从 `string` 放宽为 `string | Blob`（S5 收窄过）；新增 `importPreview(file)`（同步 200）、`importPackage(file)`（202）、`adopt(body)`；`src/client/panel.tsx` 恢复 "import package" 那一行（选文件 → preview → 逐条渲染四态与候选根 → 确认 import → `track(job)`），并在 `entry.hasGitSource === false` 的卡片上渲染 "attach source" + url 输入 + adopt 按钮（`adoptInputs`，照既有 `refInputs` 模式）。
  - `EntryCard` 导出（`test/panel-render.test.ts` 用），只为让 `hasGitSource` 决定的那两个分支能被直接渲染断言。
  - **测试基建（都不动产品面）**：`tsconfig.test.json` 补上 `jsx: react-jsx` + DOM lib 并纳入 `src/client/**/*.tsx`——那是仓库里唯一的 `.tsx` 源，主构建本来就排除它，现在让 `test:build` 也能编译它；同一 config 的 include 从 `test/**/*.ts` 放宽为 `test/**/*`，好让下面那份 `.d.ts` 生效。新增 `test/react-dom-server.d.ts`（**只声明用到的那一个函数**），避免为一条测试引入 `@types/react-dom`；`src/client/panel.tsx` 保留一行运行时 `React` 默认导入并附说明与 eslint 抑制——tsx/esbuild 不读任何 tsconfig 的 `jsx`（`tsconfig.json`、`tsx.config.json`、`--tsconfig`、`ESBUILD_JSX` 四条路都试过、都不生效），classic runtime 会为它发出 `React.createElement`；tsdown 自己用 automatic runtime 且消掉这行 import，**出厂 bundle 不受影响**（已核验 `lib/client.js` 里四态文案是内联的，没有对 `import-decision` 的 `require`）。
  - 文档：README 双语的面板能力清单（导入包 / attach source / 长操作含 import · adopt）与 HTTP 路由清单（加 import · adopt）同步；CONTRIBUTING 双语的源码树（`import-decision.ts`、`ops-io` 的 `spin`）与两张测试映射表（11→13 条路由、新增 `install-spin` / `panel-render` 行）同步。
- **不做**：不给面板引入浏览器测试台/DOM 依赖（见「验证方式」的取舍说明）；不做 `export` 的面板入口（§10.3 明确可后置）；不恢复 multipart 解析器（理由见上）；不改 `list` 载荷与既有路由的契约（`JobKind` 只是加两个取值，客户端字段一个没动）；`updateEntryCore` / `toggleEntryCore` 两处镜像仍未统一。
- **测试**：新增 **17 条**（`npm test` 481 → 498 起点，含 `panel-render` 5 条与最终为 503）。`test/api.test.ts`：import 的缺包体 400、跨源 403、**同步 dry-run 200**（断言 `labelled:false`、条目名取自文件名、判定为 `no-source`、manifest 未变、临时目录已删、**未占 flight**）、带标签包在 `noNetCheck` 下判定为 `not-checked`（§10.2 明确"未检测"不得写成 `unreachable`）、缺 `confirm` 的 409 + 不注册、确认后 202 任务落快照（条目/克隆/链接齐备、临时目录清理干净）、adopt 的字段校验 400、跨源 403、未知条目 404、缺确认 409、`external-entry` 409（且目录未被触碰）、坏 url 400；表长断言由 11 同步为 **13**（`add-zip` 不得回归的断言保留）。`test/cli-plugin-parity.test.ts`：adopt 的 CLI↔路由对照（同一夹具两侧跑，断言条目形状、名字/path 不变、两侧都留下真克隆与 `.pre-adopt-*` 备份、**未链接的条目两侧都不被悄悄启用**）、已链接条目的路由侧重建成同一链接名、缺失条目是**线路上的 404**（不是 job 错误）。`test/client-api.test.ts`：`importPreview`/`importPackage` 的请求形状（裸 body 是那个 File、`x-nexus-filename` 头、`dryRun`/`confirm` 与各选项进查询串、未设置的选项不得出现）、`adopt` 的 JSON 体。**新增 `test/panel-render.test.ts`（5 条，已登记进 `test` 脚本）**：面板首屏渲染 import 行、空状态、无 git 源卡片只有 attach source（无 update/switch、url 未填时按钮禁用）、git 卡片反之、填入 url 后按钮可用且值可回传。全量 `npm test` **503 条 · 500 通过 · 0 失败 · 3 跳过**（上一提交 481 · 478 · 0 · 3，净 +22）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码全 0（一次 `danger-full-access` 提权）。**面板 UI 没有自动化点击测试**——没有 DOM 测试台，本轮也**不引入 jsdom 之类的新依赖**（那需要先问用户）。替代方案是把能纯渲染断言的部分拿掉：`panel-render` 用 `react-dom/server` 静态渲染断言"首屏/卡片由 props 决定"的那一层（副作用不跑、点击不覆盖），其余的对话框/轮询/确认流程由**路由合同 + 客户端合同**两条测试链兜住；`test:build` 的 loader-free 回程（`node --test test-dist/test/`）也一并验过。写了这条测试就抓到两个真问题：① 无标签包的条目名来自上传文件名，最初把临时文件命名成内部方案，会让面板导入的条目叫 `upload-…-<ts>`——改成"临时目录唯一、文件名保持原样"；② `adopt` 的 404/409/400 原本只会落进 job 记录，抽出 `assertAdoptable` 才真正回到线路上（这一条同时把 CLI 与面板钉在同一个守卫上）。
- **如何辨识改动**：新增 `src/import-decision.ts`、`test/panel-render.test.ts`、`test/react-dom-server.d.ts`；改 `src/http/routes.ts`（import / adopt 两条路由 + 状态映射 + `MAX_PACKAGE_BYTES`）、`src/http/jobs.ts`、`src/adopt.ts`（`assertAdoptable`）、`src/import.ts`、`src/cli/commands/import.ts`、`src/client/api.ts`、`src/client/panel.tsx`，以及 `test/{api,cli-plugin-parity,client-api}.test.ts`、`package.json`（仅 test 脚本 +1 文件）、`tsconfig.test.json`、`README.md` / `README_CN.md` / `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`（双语成对，随本提交同写、不另开文档提交）与相应 `lib/` 产物（含 `lib/client.js` / `lib/client.js.map` / `lib/client-types/**` 重建入库），以及本 CHANGELOG。

**2026-10-02 · Changed · 抽掉共享安装核心对 CLI 展现代码的依赖：`io.spin` 可选接缝，`cliIO.spin` 就是 `withSpinner` 本身（CLI 输出逐字不变）**

- **背景**：`src/install.ts` 是 CLI 与面板共用的安装核心，但它顶部 `import { withSpinner } from './cli/progress.js'` 直接用了 CLI 的终端动画——模块注释里那句"还不是纯展示层"说的就是这件事。只要这行还在，"两侧共用同一实现"就永远差一块：面板一旦跑这段代码，就有把 `\r`/ANSI 塞进被轮询的 job 记录的风险。本次把 spinner 变成一个调用方能注入、也可以完全不实现的接缝。
- **变更**：
  - `src/ops-io.ts`：`OpsIO` 新增**可选**成员 `spin?<T>(message, fn): Promise<T>`，注释写清"进度是装饰性的、永不承载语义"，以及为什么是可选的而不是必填——`src/` 与 `test/` 里共有 **9 处 OpsIO 字面量替身**（`src/http/io.ts` 两处 + `export` / `adopt`×2 / `update-pipeline` / `switch-version` / `import`×2 七处测试），加必填成员会让它们全线 typecheck 失败，而代价只是"忘了实现的前端静默无进度"，与写一个空实现毫无区别。
  - `cliIO.spin = withSpinner` —— **同一个函数对象，不是包装**：TTY 门控、`\r` + erase-line、光标隐藏/恢复、`clampToWidth`、定时器 `unref` 全部原样，所以 CLI 的字节输出不变。
  - `src/http/io.ts`：`jobIO.spin` 先把 spinner 标签还原成 job 的 `stage`/`detail`（`cloning (main)` → `('cloning','main')`，正是统一前 `installGitCore` 自己设的那一对，顺带保留了取消检查点），然后**直接跑 `fn`**——被轮询的记录不该收到动画帧；`quietIO.spin` 就是跑 `fn`（同步路由没有 job 记录可报）。
  - `src/install.ts`：`const spin = io.spin ?? (<T>(_m, fn) => fn())`，删掉 `./cli/progress.js` 的 import，模块注释改成"已经是纯展示无关的"。**调用点一处、消息一处未变**：`spin(\`cloning (${gitSpec.ref})\`, …)`。
- **不做**：`installFromGit` 里 S3a 为"输出逐字不变"保留的 `process.stderr.write` **仍未 OpsIO 化**（那需要另一次输出等价性证明，要动请单独提交）；不给 OpsIO 加必填成员（理由见上）；不动 9 处替身（可选项让它们一个都不用改）；面板的 job 阶段序列只做了等价替换，没有新增阶段。
- **测试**：新增 `test/install-spin.test.ts` **6 条**（并登记进 `package.json` 的 `test` 脚本）——注入 `spin` 时**恰好调用一次**且消息是 `cloning (main)`、被包裹的步骤真的执行（克隆落地 + 链接建立）；注入的 `spin` 抛错时原样抛出且**不残留半成品克隆**；**完全没有** `spin` 成员的前端照常安装；`spin` 显式 `undefined`（`??` 的另一支）也照常安装；`cliIO.spin` 与 `withSpinner` **同一性断言**（`assert.equal(cliIO.spin, withSpinner)`——用等价断言就守不住"逐字不变"这个承诺，包装一层完全可能悄悄丢掉 TTY 门控或 ANSI 序列）；非 TTY 下调 `cliIO.spin` **stderr 一个字节都没有**。另在 `test/api.test.ts` 补 1 条面板侧端到端：本地 `file://` 仓库走 `add` 到 job 完成，断言 `stage='cloning'` / `detail='main'`（即统一前后阶段等价）、`output` 里有 `Cloning ` 行、且**整条记录不含 `\r` 或 ESC**。全量 `npm test` **481 条 · 478 通过 · 0 失败 · 3 跳过**（上一提交 474 · 471 · 0 · 3，净 +7）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码全 0（一次 `danger-full-access` 提权）。CLI 输出等价性用的是**同一性**证据而不是"跑一遍看着像"：`cliIO.spin` 与 `withSpinner` 是同一个对象引用，因此动画逻辑根本不可能被这次改动碰到。新用例先各自单跑确认走对分支（`install-spin` 6/6、`api`+`ops-io`+`progress` 合计 52/52）。
- **如何辨识改动**：改 `src/ops-io.ts`（新增可选成员 + `cliIO.spin`）、`src/http/io.ts`（`jobIO.spin` / `quietIO.spin` 与 `spinnerStage`）、`src/install.ts`（删 import、改用 `io.spin`）；新增 `test/install-spin.test.ts`；改 `test/api.test.ts`、`package.json`（仅 test 脚本 +1 文件）与相应 `lib/` 产物（`lib/install.*`、`lib/ops-io.*`、`lib/http/io.*`），以及本 CHANGELOG。

**2026-10-02 · Changed · 面板 `add` 改为调用共享安装核心 `src/install.ts`：删掉 `routes.ts` 的 `installGitCore` 镜像，5 个 400 码从核心的失败码重建（首次补测）**

- **背景**：设计稿 `docs/sources-and-packages.md` §10.1 要求 `import` / `adopt` 由 CLI 与面板调用**同一实现**，并点名"当前 `installFromZip` 只被 `add-zip` 路由调用、CLI 无对应命令"正是两侧不一致的反例。S3a 已把 CLI 侧抽成 `src/install.ts`，但 `src/http/routes.ts` 里还留着同一段编排的第二份手写镜像（`installGitCore` + `GitInstallPlan`）：它会独立漂移，而下一步的 `import` / `adopt` 面板入口正要复用这条路径。本次就是把面板这半也收到同一核心上。
- **变更**：
  - **失败码显式化**：`GitInstallResult` 新增可选 `code?: GitInstallFailCode`（`'subdir-not-found' | 'dsh-plugin-repo' | 'no-skill-md' | 'no-installable-skills' | 'aborted'`），每个非 `installed` 的返回点各自标一个。**没有它就无法统一**——`status` 三态是压缩信息（三条 `failed` 路径塌成一个），光看状态无法把面板原先的 5 个码还原回去。CLI 侧读 `status` 的既有映射一字未改。
  - `src/http/routes.ts`：删 `installGitCore` 与 `GitInstallPlan`（净 −159 行），`add` 路由在 `accept()` 的 op 里调用 `installFromGit({ spec, gitSpec, subdir, skillName, path, name: undefined, subdirLeaf, yes, io })`，并把 `failed` / `skipped` 按 `code` 抛回 `HttpError(400, code, { name })`。**只读预检（`parseGitSpec` / `normalizeSubdir` / 名字推导 / 409 重复登记 / 409 碰撞）按原样留在路由里**——`installFromGit` 明确把预检留给调用方，受理前拒绝的语义不变。
  - **顺手补上面板缺的默认分支探测**：原 `installGitCore` 直接拿 `ref ?? 'main'` 去克隆，而 CLI 的 `addOne` 会在未指定 ref 时探测远端默认分支——所以**默认分支不是 `main` 的仓库在面板上装不上**，这正是镜像漂移的实证。现在路由在预检里做同一步（照 `adopt.ts` 的做法），探测失败抛 `400 clone-failed`（与其它预检失败一样在 202 之前决定，不走 500）；CLI 那句 `Detecting default branch` 是 CLI 自己的输出，不在面板复刻。
  - `LARGE_COLLECTION_THRESHOLD` 改由 `routes.ts` 直接从 `../install.js` 导入；`src/cli/commands/add.ts` 的再导出保留（仍是 `add` 的公开面），注释同步。清理因此失效的 import（`cloneRepo` / `classifyRepo` / `isRealDirectory` / `addEntry` / `mkdir` / `rm` / `REPOS_DIR` / `CloneResult` / 从 `add.js` 拿阈值的路径）；`update` / `toggle` 仍在用的 `repoDir` / `getHeadCommit` / `join` / `stat` / `REPOS_DIR` 逐个 grep 确认后保留。
  - **修一个统一后才暴露的真回归**：面板的 `jobIO.confirm` 不返回 `false`，而是**抛 `NeedsConfirm`**。`installFromGit` 的两处确认（wrapped-skill 包装层、大集合守卫）都发生在克隆**之后**，原来的调用方 `installGitCore` 是先 `rm(dest)` 再抛错，所以没留下垃圾；换成共享核心后异常直接从 `io.confirm` 穿出，**克隆目录会残留**（什么都不注册、`repos/<path>` 却占着，重试会撞"目录已存在"）。新增 `confirmOrCleanUp(io, question, dest)`：`io.confirm` 抛错时先删掉本次克隆再原样抛出，确认答案本身原样返回，CLI 两条路径（非 TTY 得 `false`、`--yes` 得 `true`）行为逐字不变。
- **不做**：`routes.ts` 的 `updateEntryCore` / `toggleEntryCore` 两处镜像**一字未动**（本轮只统一 add 的安装阶段；顺手改就没法证明"行为等价"，要动请单独一个提交）；`installFromGit` 里 S3a 为"输出逐字不变"保留的 `process.stderr.write` 也没碰（改走 `io.emit` 是又一次输出等价性证明）；`dsh-plugin-repo` / `aborted` 两个码在面板上**实际不可达**（`jobIO.confirm` 只会抛 `NeedsConfirm`，而 `dsh-plugin` 分支根本不到 confirm），保留在映射表里只为守住 §10.4 的方言不被后来者改错；`lib/client.js` 不重建（客户端契约未变：`JobKind` 未加、请求/响应字段未加）。
- **测试**：`test/api.test.ts` 的 add 系列（缺 `url` / 409 重复登记 / 409 碰撞 / 跨源 403）与 `test/add.test.ts` 全部照旧通过，证明"预检在受理前"的语义未动。新增 **6 条**：`test/cli-plugin-parity.test.ts` 补 `add` 的 CLI↔路由对照（同一夹具两侧跑、都走默认分支探测，断言入场字段逐项一致、链接集一致、两边都是真克隆且各自记录了自己 HEAD 的 commit）；**5 个 400 码首次被覆盖**——`subdir-not-found` / `no-skill-md` / `no-installable-skills` / `dsh-plugin-repo` 走 `202` + job `error` 断言，wrapped-skill 则断言它落到 `confirmation required: …`（面板确认语义）且**不注册、也不残留克隆目录**（这条正是上面那个回归的守卫）。全量 `npm test` **474 条 · 471 通过 · 0 失败 · 3 跳过**（基线 468 · 465 · 0 · 3，净 +6）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码全 0（一次 `danger-full-access` 提权；`workspace-sandbox` 下 npm/tsx 以管道 stdio 启动子进程会 `spawn EPERM`）。差异对照是**先做后改**：把 `installGitCore` 与 `installFromGit` 逐段列表比对（输出通道、checkout 行、`--name` 提示、失败语义、确认时机），确认每一处"保留/丢弃"后才动手；其中"面板缺默认分支探测"与"确认抛错残留克隆"两处是比对/新用例逼出来的，都不是原计划里写好的。新用例先各自单跑复现失败原因（曾把"零技能"夹具写成 `alpha/notes.md`，实测 `locateSkillFiles` 只认根级 `.md`，改成根级 `notes.md` 才真正走到 `no-installable-skills`——**这条例子的价值全在走到正确分支**）。
- **如何辨识改动**：改 `src/install.ts`（失败码枚举 + `confirmOrCleanUp` + 模块注释）、`src/http/routes.ts`（`add` 路由与 import 图；`installGitCore` / `GitInstallPlan` 消失）、`src/cli/commands/add.ts`（仅注释）、`test/cli-plugin-parity.test.ts`（+192 行）与相应 `lib/` 产物（`lib/install.*`、`lib/http/routes.*`、`lib/cli/commands/add.*`），以及本 CHANGELOG。

**2026-10-02 · Removed · 退役 zip：删 `add-zip` 路由与 `src/zip.ts` 的安装编排、移除 `source` 字段（`list` 载荷与面板同步改为 `hasGitSource`）**

- **背景**：设计稿 `docs/sources-and-packages.md` §8 阶段 3。S1 已把"能不能更新"的判据换成 `hasGitSource`、S3 已让 `import` 接管包入口，所以这一步是**纯减法**：摘掉"zip 作为安装方式"的最后一层，不该牵动任何行为。**旧 zip 条目无需任何数据迁移**——它们的 `gitUrl`/`ref`/`commit` 在安装时就是空的，删掉 `source` 后行为与"快照副本"（§2.1 形态 b）完全一致：`list` / `enable` / `disable` / `remove` 照常，`update` / `switch-version` 继续以 `not-a-git-clone` 明确拒绝。
- **变更**：
  - 删 `src/http/routes.ts` 的 `add-zip` 路由、手写 multipart 解析器（`multipartBoundary` / `extractMultipartFile`）与 `ZipError` → 400 的错误映射；路由表 12 → 11 条。`src/http/jobs.ts` 与 `src/client/api.ts` 的 `JobKind` 去掉 `'add-zip'`；客户端删 `addZip()` 与 `FormData` 请求体类型（客户端只剩 JSON 体）。
  - 删 `src/zip.ts` 的安装编排：`installFromZip` / `deriveEntryName` / `extractEntries` / `pathExists` / `MAX_ARCHIVE_BYTES`（HTTP 上传上限，随路由一起消失）以及 `ZipInstallOptions` / `ZipInstallResult`；`parseAndValidate` 不再返回 warnings。**保留 `readZip` / `createZip` / `ZipError` 与体积、条目上限常量**——它们已是包编解码器：`import` 读外部包时的静态加固（zip-slip、`:` 段、NUL、加密、zip64、三重上限）一字未改。
  - `src/types.ts` 删 `source?: 'github' | 'zip'`。**客户端契约同步**：`list` 载荷的 `source: entry.source ?? 'git'` 换成 `hasGitSource: hasGitSource(entry)`；面板的 `zip` 徽标与"无 git 源就不显示 update / switch"改为直接读这个布尔值——与路由自己的 `400 not-a-git-clone` 判据同源，两边不可能再各说各话。
  - 面板 `src/client/panel.tsx`：删 `isZip` 分支、`zip` 徽标与 zip 上传整行（选文件 + upload 按钮）；条目元信息直接显示 `url · subdir`，`update` / `switch-version` 由 `hasGitSource` 门控。
  - 文档同步（双语成对，改一份必改另一份）：`README.md` / `README_CN.md` 的面板能力与 `/skills-nexus/*` 路由清单去掉 zip 上传；`CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md` 的源码树与两张测试映射表改述为"包编解码器"与"11 条路由"。
- **不做**：面板的包导入入口（原 zip 上传行）**留空**——`import` 的面板位按 §10.3 后置，那一行等它来占（面板能力因此净减一项，已在上面写明）；不做 zip → git 的来源猜测；`readZip` 对 `.git` 条目仍是**跳过**而非 §5 字面要求的"发现即拒绝该条目"，本次按纯减法原则不改该行为。
- **测试**：`test/zip.test.ts` **未整文件删除，而是收敛为包编解码器测试**（23 → 19 条：读取 / 往返 / 跳过三类条目 + §9.1 全套拒绝矩阵）——理由是 `readZip` 是**外部输入**的唯一入口，整文件删除等于丢掉 zip-slip、加密、zip64、三重上限的回归网。作为补偿，`test/import.test.ts` 新增一条 collision 用例（技能根里手工放置的真实目录必须被拒绝、绝不被清掉），把随 `installFromZip` 消失的那条守卫补在仍然存在的层上。`test/api.test.ts` 的 2 条 add-zip 用例并为 1 条**退役断言**（路由表中不存在该路径，且总数恰为 11）；`test/client-api.test.ts` 删 add-zip FormData 用例；`test/doctor.test.ts` 的 `makeZipEntry` 夹具改述为 `makeSnapshotEntry`（空 git 字段是结构而非损坏，覆盖点不变）；`update-pipeline` / `switch-version` / `adopt` 三处 `source: 'zip'` 夹具与断言随字段删除。全量 `npm test` **468 条 · 465 通过 · 0 失败 · 3 跳过**（基线 473 · 470 · 0 · 3；净 −5：zip.test.ts −4、api.test.ts −1、client-api.test.ts −1、import.test.ts +1）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码全 0。第一轮门禁抓到一处真实遗漏——`test/api.test.ts` 的 switch-version 用例仍引用被改名的 `up-zip` 夹具（404 ≠ 400）；改名后第二轮全绿。这条恰好证明该夹具是**跨用例共享**的，改名不能只改一处。
- **如何辨识改动**：删 `src/zip.ts` 的安装编排与 `src/types.ts` 的 `source` 字段；改 `src/http/routes.ts`、`src/http/jobs.ts`、`src/client/api.ts`、`src/client/panel.tsx`，以及 `src/health.ts` / `src/manifest.ts` / `src/adopt.ts` 的相关注释与写点；改 `test/{zip,api,doctor,client-api,import,update-pipeline,switch-version,adopt}.test.ts`；改 `README.md` / `README_CN.md` / `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`；相应 `lib/` 产物（含 `lib/client.js` 重新打包）与本 CHANGELOG。

**2026-10-02 · Added · `adopt` 命令：给"无 git 源"条目补身份（七步编排 + 失败整体回滚，命令面与四份补全同步）**

- **背景**：设计稿 `docs/sources-and-packages.md` §6/§10.1 的通道 D。快照条目（包导入落下的、旧 zip 装出来的、别人给的目录）永远不能 `update` / `switch-version`——它们的 `gitUrl` 是空的。上一轮的 `import` 只在**导入那一刻**能按标签重克隆；已经躺在机器上的冻结条目，唯一的转正动作就是 `adopt <name> --url <repo>`。§6 同时禁止 URL 猜测：身份必须由用户显式给出。
- **变更**：
  - 新增 `src/adopt.ts`（`adoptSkill`）：§6 的七步与 `switch-version` 同构——① 解析 `--url`/`--ref`（未给 ref 时照 `add` 的做法探测远端默认分支）并克隆到 `repos/.adopt-stage-<name>-<pid>-<ts>`；② 用**安装自己的发现规则**（`previewSkills`，规则一字未改）算出"这个源会链接出哪些名字"，与现有目录算出的集合比对，不一致默认拒绝；③ 现目录备份为 `repos/<path>.pre-adopt-<ts>`；④ 暂存目录就位；⑤ 先按归属删旧链接集、再按新发现建（单技能→条目名、多技能→frontmatter 名，与 `switch-version` 第 6 步同一套判据），**原本禁用的条目不会被静默启用**；⑥ 写回 `url/gitUrl/ref/commit/subdir` 并刷新 `updatedAt`；⑦ `--prune` 删备份，否则报出备份路径。
  - **失败整体回滚**：任一步失败 → 按归属卸掉当前链接 → 删掉新克隆 → 备份改名回 `repos/<path>` → 重建旧链接；回滚自身的错误 best-effort 吞掉（照 `rollbackSwitch`）。§9 的不变量"目录、链接、manifest 三者与操作前一致"由逐字节对照钉住。**manifest 写入之前失败绝不动 manifest；`--prune` 删备份失败也不回滚**——否则会造出"manifest 说有 git 源、目录却是旧快照"的分裂状态。
  - 三处相对 §6 草图的补强，都是为守住既有不变量而非加功能：① 新克隆**落盘前做安装期归一化**（与 `add`/`switch-version` 同一约定），否则非法 frontmatter 名会让条目"看起来链接了、却被官方 provider 静默跳过"；② 新链接名与官方技能根里的**真实目录**冲突时前置拒绝（与 `add` 的 `hasCollision` 同级）；③ **`ownership: 'external'` 条目直接拒绝**——§2.1 的硬不变量 `external ⇒ gitUrl === ''` 的意义就是 nexus 永不碰用户自己的目录，而 adopt 必须替换那个目录。
  - `subdir` 默认继承条目已记录的值（技能根属于条目身份，§7 也只允许用 `subdir` 表达偏移），`--subdir .` 显式表示克隆根（manifest 记为无 `subdir`）。`--force` 一个开关管两件事：换源（已有 git 源）与绕过发现不一致。
  - 成功后**删除 legacy `source: 'zip'` 标记**：条目已有 git 源，该字段与之矛盾，且 `list` 载荷会把它渲染成面板的 zip 徽标（客户端契约）。
  - `src/cli/args.ts` 新增 `parseAdoptArgs`（`--url` 必填、`--ref`/`--subdir` 取值、`--force`/`--prune` 布尔且拒绝内联值、未知 flag = 用法错误）；新增 `src/cli/commands/adopt.ts`（持每技能文件锁 → 调共享核心 → 打印结果，退出码 0/1/2）；`src/cli/index.ts` 注册路由并在 `--help` 补 Usage 与 `adopt options` 两段；四份补全模板同步子命令集合与 `--url`/`--ref`/`--subdir`/`--force`/`--prune`（漂移守卫拿 `--help` 与路由本身比对，不能只改一处）。
- **不做**：面板入口未接（§10.3 允许后置，条目行内 "attach source" 属下一提交）；不改条目名、不改 `path`；不做 URL 猜测；不清理历史遗留的 `.pre-adopt-*`（`--prune` 只删本次的）。
- **测试**：新增 `test/adopt.test.ts` **13 条**（并登记进 `package.json`）——快照→git 条目（`hasGitSource` 为真、`.git` 存在、提交写回、链接重建、`source:'zip'` 被清、备份内容正确、归一化计数 2）；`--prune` 删备份；无目录条目走修复路径且**保持禁用**；`--force` 换源（旧克隆被替换而非合并）；发现不一致默认拒绝（状态逐项对照 + 无暂存残留）与 `--force` 放行；`subdir` 继承与 `--subdir .` 覆盖；克隆失败零副作用；**写 manifest 失败触发回滚**，目录/链接/manifest 三者复原；五类前置拒绝（未知名、external、空 url、`ext::` 危险 url、`../` subdir）；CLI 退出码 0/1/2 与 stdout 洁净。全量 `npm test` **473 条 · 470 通过 · 0 失败 · 3 跳过**（基线 460 · 457 · 0 · 3；+13 为本轮新增）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码全 0（一次 `danger-full-access` 提权：npm 在 workspace-write 下以管道 stdio 启动 tsc/eslint/node 会 spawn EPERM）。回滚用例是**故障注入**而不是"随便造个失败"：把 `<manifest>.tmp` 占成目录，让 `writeManifest` 的 `writeFile` 必失败——失败点落在"新克隆已经就位"之后，正是回滚存在的理由。
- **如何辨识改动**：新增 `src/adopt.ts`、`src/cli/commands/adopt.ts`、`test/adopt.test.ts` 及对应 `lib/` 产物（`lib/adopt.*`、`lib/cli/commands/adopt.*`）；改 `src/cli/args.ts`、`src/cli/index.ts`、`src/cli/commands/completions/{bash,zsh,fish,powershell}.ts`、`package.json`（仅 test 脚本 +1 个测试文件）与相应 `lib/` 产物，以及本 CHANGELOG。

**2026-10-02 · Added · `import` 命令：包 → 条目（优先按标签恢复远端，否则落快照并还原状态）**

- **背景**：设计稿 `docs/sources-and-packages.md` §4.2/§10.1/§10.3 里通道 C 的消费侧。它的价值全在标签：**有标签且远端可达时走 `installFromGit`**（与 `add` 同一条安装路径 → 真克隆、可更新、可切版本），否则落成快照；**裸包**（别人打的 zip）则靠剥壳扫描找到技能。§10.1 要求 CLI 与面板共用同一核心，因此全部逻辑在 `src/import.ts`，命令只是薄壳。
- **变更**：
  - `src/import.ts`：`stagePackage`（zip → 临时目录展开、目录包就地读）/ `planStaged`（决策，零副作用）/ `importPackage`（规划 + 应用，返回 `{ plan, result? }`）。**剥壳扫描**：先按安装自己的三条规则判断根是否命中，未命中且根下**恰有一个子目录**就剥一层（≤3 层）——规则本身一字未改，`skills/alpha/SKILL.md` 剥 1 层、`export-2026/skills/alpha/SKILL.md` 剥 2 层。
  - **四态可达性**（§10.2）：`reachable` / `unreachable` / `timeout`（5s，**与失败分开**）/ `not-checked`；同一 remote 只探一次。
  - **状态还原**：标签的 `enabled` 与**逐技能链接名**都还原——git 路径下若上游是禁用的，安装后显式解链；快照路径按记录的链接名建链，手工别名得以存活。
  - **错误分级**：`no-skill-found`（"这不是技能包"）vs `skill-nested-too-deep`（附实际文件并提示 `--subdir`）；另有 `newer-package` / `invalid-package` / `already-registered` / `collision` / `install-refused` / `nothing-to-import` / `package-not-found`。`--force` 的语义是**替换**（复用 `remove` 共享核心：反注册 + 解链 + 删 nexus 拥有的目录）。
  - `src/cli/commands/import.ts` + `parseImportArgs` + `index.ts` 的路由与帮助三段 + 四份补全模板（子命令与九个 flag）。`--dry-run` 打印四态判定行。
- **不做**：面板上传入口**未接**（§10.3 允许后置，属下一提交）；未引入任何"包内带 `.git`"之类档位；`source` 字段、`add-zip` 路由与 `src/zip.ts` 的安装编排仍未改动。
- **测试**：新增 `test/import.test.ts` **16 条**——`export` → `import` 环形往返必须还原成**可更新的 git 条目**、禁用态保持禁用、快照路径、剥壳 1 层与 2 层、两种错误分级、`--subdir` 救深包、`--dry-run` 三处状态零变化（manifest / repos / 技能根逐字节对比）、四态决策、冲突与 `--force`、清单变体、`--each`、CLI 退出码 0/1/2。全量 `npm test` **460 条 · 457 通过 · 0 失败 · 3 跳过**（基线 444 · 441 · 0 · 3；+16 恰为本轮新增）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。**测试作者独立复核时发现两处我的缺陷**，两处都按"改源码、不放宽断言"处理：① `findSkillFiles` 曾无条件收集任意层级的 markdown，于是**只有根级 `notes.md`** 的包被误报为"层级太深"（`no-skill-found` 实际不可达，而它建议的 `--subdir` 也救不了根级文件）——改为只把**超出剥壳预算**的 markdown 计入；② `planStaged` 在 `--no-net-check` / `--no-remote` 下**仍会探测远端**（最多白等 5 秒），与这两个选项"离线零等待"的承诺矛盾——改为仅在需要判定时探测。两处修正后该文件 16/16 通过。
- **如何辨识改动**：新增 `src/import.ts`、`src/cli/commands/import.ts`、`test/import.test.ts` 及对应 `lib/` 产物；M `src/cli/args.ts`、`src/cli/index.ts`、`src/cli/commands/completions/{bash,zsh,fish,powershell}.ts`、`package.json`（仅 test 脚本 +1 个测试文件）、本 CHANGELOG 与相应 `lib/` 产物。

**2026-10-02 · Changed · 抽出共享 git 安装核心 `src/install.ts`：`add` 的"克隆 → 归一化 → 注册 → 建链"逐字搬迁，行为等价**

- **背景**：设计稿 `docs/sources-and-packages.md` §10.1 要求 `import` / `adopt` 与既有安装走**同一条实现**——新的"按标签恢复远端"若另写一份克隆 + 注册 + 建链，本仓库就会立刻拥有**第三份**会各自漂移的实现（已有 CLI `src/cli/commands/add.ts` 与面板 `src/http/routes.ts:installGitCore` 两份镜像）。本次先把 CLI 侧那份抽成共享核心，`import` 直接复用。
- **变更**：新增 `src/install.ts` —— `installFromGit(params)` 即原 `src/cli/commands/add.ts` 的 `installOne` **逐字搬迁**（43 处 `io.emit`/stderr 字符串字面量逐一核对：值与顺序均一致；`nestedHint` / `hasNestedSkills` / `LARGE_COLLECTION_THRESHOLD` 同块搬迁且与 HEAD 逐字节相同）。`src/cli/commands/add.ts` 保留只读预检（`--subdir` 校验、默认分支探测、重复登记与碰撞检查）与按技能的文件锁，改调核心，并把结果映射回原来的 `AddResult`（`installed → added`，`skipped` / `failed` 透传）——输出与退出码逐字不变。
- **返回形状**：`GitInstallResult = { status: 'installed' | 'skipped' | 'failed'; entry?: SkillEntry; links; normalized; clone }`。引入判别式是因为**跳过的两条路径**（DSH-plugin 包装确认被拒、大集合确认被拒）与**失败的三条路径**（`--subdir` 不是真实目录、仓库既非 SKILL.md 仓库也非 DSH 插件、未发现可安装技能）本就没有条目可返回；`clone` 保持必填（这些返回都发生在克隆成功之后，克隆/网络错误仍照原样抛出）。**没有新增任何失败模式。**
- **`LARGE_COLLECTION_THRESHOLD` 由 `add.ts` 再导出**：`src/http/routes.ts` 从 `add.ts` 导入它，而本次不动路由文件（面板侧镜像留待退役阶段）；若改在 `add.ts` 内定义，`install.ts` 就会反向依赖自己的调用方。
- **不做**：`src/http/routes.ts` 的 `installGitCore` 镜像**一字未改**（面板与 CLI 的统一不属于本阶段）；`import` / `adopt` 对核心的实际调用在下一提交；`source` 字段、`add-zip` 路由与 `src/zip.ts` 的安装编排仍未改动。
- **测试**：**不新增用例**——纯搬迁的验收标准就是"既有用例逐条不变"，`test/add.test.ts` 的 23 条覆盖被搬迁的全部路径。全量 `npm test` **444 条 · 441 通过 · 0 失败 · 3 跳过**，与搬迁前逐项一致。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。搬运者另做了两项更强的等价性核对：① 搬迁体的 43 处字符串字面量与原文件逐一比对（值 + 顺序）；② 用 `tsc` 输出到临时目录，与入库的 `lib/install.*`、`lib/cli/commands/add.*` **逐字节一致**（证明入库产物确为当前源码的产物）。
- **如何辨识改动**：新增 `src/install.ts` 及产物 `lib/install.js` + `.js.map` + `.d.ts` + `.d.ts.map`；M `src/cli/commands/add.ts`（净删约 234 行：-262/+28）与 `lib/cli/commands/add.*` 四个产物，以及本 CHANGELOG。

**2026-10-02 · Added · CLI `export` 命令面（帮助文本 + 四份补全模板同步）：`export <name>... | --all [--out <file>]`**

- **背景**：接上一提交的 `export` 核心。设计稿 §10.1 要求命令面与核心一次成型——仓库里存在**漂移守卫测试**：四份补全模板的子命令集合必须等于 `src/cli/index.ts` 路由的 `case` 集合，且 `--help` 中出现的每个长选项都必须在四份模板中出现。因此命令面不能"先加代码、补全后补"。
- **变更**：`src/cli/args.ts` 新增 `parseExportArgs`（`--all`、`--out`/`-o`、位置名；拒绝未知 flag、拒绝 `--all` 与名字混用、拒绝空选择）；新增 `src/cli/commands/export.ts`（`exportCommand`：推导默认输出名 → 调核心 → 两行结果输出；退出码 0/1/2）；`src/cli/index.ts` 注册路由并在 `--help` 的 Usage、`export options`、`Batch` 三段补齐说明；四份补全模板（bash/zsh/fish/powershell）加入 `export` 子命令与 `--all`/`--out` 选项。
- **默认输出名**：单名 → `<name>.zip`；多名 → `nexus-export.zip`；`--all` → `nexus-export-<YYYYMMDD>.zip`（本地时间，便于按时间排序）。扩展名决定形态：`.zip` 写归档，其他写目录树。
- **选项严格度**：与 `add`（容忍未知 flag）相反，`export` **拒绝**未知参数——它的输出名由输入推导，"拼错一个字母却静默导出全部"不可接受；`--all` 与显式名字互斥同理。`-o` 作为 `--out` 的别名被接受但**不出现在 `--help`**（与 `-y` 之于 `--yes` 同一处置）。
- **completions 的一处不变量调整**：模板此前声明"能补名字的命令都没有取值 flag，因此 flag 值不会被误计为位置参数"。`export --out <file>` 是第一个取值 flag，而 `export` 也吃位置名——本提交选择**不把 `export` 放进名字补全分支**（并在四处注释写明原因），而不是把四个 shell 的位置计数改成"跳过 flag 值"。理由：改动面更小、不触碰会被真实 shell 执行的计数逻辑，代价仅是 `export <TAB>` 不补名字。
- **不做**：`import` / `adopt` 未动；面板入口未动（设计稿 §10.3 把 `export` 的面板位列为可后置）；`source` 字段、`add-zip` 路由与 `src/zip.ts` 的安装编排**仍未改动**。
- **测试**：`test/export.test.ts` 追加 5 条 CLI 用例（经 `OpsIO` 接缝注入，**不 patch `process.stdout`**）：写包并回报路径、`--out=value` 等值、默认命名（单名与 `--all` 的日期名，经 `process.chdir` 指向临时目录后断言）、用法错误退出 2 且 stdout 为空（5 种输入）、导出失败退出 1（核心 `ExportError`）。全量 `npm test` **444 条 · 441 通过 · 0 失败 · 3 跳过**（上一提交基线 439 · 436 · 0 · 3；+5 恰为本轮新增）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。过程中一处修正：`export` 空参数最初落到核心守卫、退出码为 1，而按 CLI 约定用法错误必须是 2——改由 `parseExportArgs` 直接拒绝（核心守卫保留，供面板侧复用，属第二道防线而非 CLI 的用法检查）。
- **如何辨识改动**：新增 `src/cli/commands/export.ts` 及产物 `lib/cli/commands/export.js` + `.js.map` + `.d.ts` + `.d.ts.map`；M `src/cli/args.ts`、`src/cli/index.ts`、`src/cli/commands/completions/bash.ts`、`zsh.ts`、`fish.ts`、`powershell.ts`、`test/export.test.ts`、对应 `lib/` 产物与本 CHANGELOG。

**2026-10-02 · Added · `export` 核心与 PKZip 写入器（来源与移植 §4.1/§5）：包 = 技能文件 + 来源标签；并引入 `ownership: 'external'` 标记（`remove` 不再删除非 nexus 所有的目录）**

- **背景**：设计稿 `docs/sources-and-packages.md` §4.1 把"把技能搬到另一台机器"定义为通道 C：包是**搬运容器**而非第二种安装格式——它必须携带**来源标签**（`url`/`gitUrl`/`ref`/`commit`/`subdir`、启用态与链接名），导入方才能优先按标签重新取货，把"永久冻结的副本"变成"可更新条目"。本提交落地产方（核心模块 + 编解码器），命令面留待下一提交。
- **变更**：
  - 新增 `src/export.ts`（`exportSkills`）：按 `--all` 或显式名字选取条目 → 逐条写入 `skills/<条目名>/…` 与 `nexus-package.json`；输出以 `.zip` 结尾走归档，否则写目录树（两种形态共用同一标签与载荷）。
  - **标签结构（v1）**：`schema` / `version` / `exportedAt` / `generator` / `skipped[]` / `entries[]`，每条为 `{ name, url, gitUrl, ref, commit, subdir?, enabled, skills[] }`，`skills[]` 记 `root`（包内相对路径）、`name`、`description`、`links[]`。`links` 按**链接目标归属**分配（复用 `entryLinks` 的同一 `pointsInto` 判据），因此集合仓库里未链接的兄弟技能不会被算到别人头上，手工别名也会被原样带出。
  - **两条边界写进实现**：包内**绝不携带 `.git`**（`walk` 跳过 `.git` 且不跟随符号链接——既不为"能不能离线切版本"而虚增体积，也不把 `.git/config` 里的凭据打包给下一个人）；**`ownership: 'external'` 条目绝不导出**（`--all` 记入 `skipped[]`，按名字点名则直接报错）。
  - `src/zip.ts` 新增 PKZip **写入器** `createZip`（stored 条目、无 deflate；名称 UTF-8 且带编码标志；拒绝绝对路径 / `..` / `:` 段 / NUL / 空段 / 超长名）与**包级读取** `readZip`（内存读入，复用既有全部静态加固规则：加密、zip64、计数与体积上限一律先拒）。读写同源，导入侧（S3）直接复用。
  - `src/types.ts` 新增 `ownership?: 'managed' | 'external'`（缺省即 managed）；`src/manifest.ts` 新增 `isExternalEntry`；`src/remove.ts` 据此**不删除 external 条目的目录**——§2.1 的硬不变量：nexus 永不删除它不拥有的目录。
- **不做**：CLI 命令面（`export` 子命令、帮助文本、四份补全模板）与面板入口留待下一提交（S2b）；`import` / `adopt` 未动；`source` 字段、`add-zip` 路由与 `src/zip.ts` 的安装编排**仍未改动**。
- **测试**：新增 `test/export.test.ts`（13 条）——标签字段与载荷往返（经 `readZip` 读回）、`--all` 保留禁用条目并记 `enabled: false`、包内无 `.git`、`--subdir` 条目只导出子目录且记 `subdir`、多技能条目的链接按目标归属、目录输出与 zip 输出等价、缺目录（点名报错 / `--all` 记入 `skipped[]`）、external（点名报错 / `--all` 跳过）、空清单与空选择、写入器拒绝逃逸路径（5 种）、`createZip` → `readZip` 逐字节往返（含中文名）。全量 `npm test` **439 条 · 436 通过 · 0 失败 · 3 跳过**（上一提交基线 426 · 423 · 0 · 3；+13 恰为本轮新增）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。**配对对照（守 ownership 边界）**：同一夹具下，`ownership: 'external'` 条目的目录在 `remove` 后**存活**，而形状相同但没有该标记的受管条目的目录**被删除**——两条断言互为对照，任一侧失效即转红。另有一处过程记录：写入器的 `a:b` 诊断最初被盘符正则先截住（报"绝对路径"），改为"盘符后必须跟分隔符才算绝对路径"后由 `:` 段规则报出，**改的是诊断精度而非测试期望**。
- **如何辨识改动**：新增 `src/export.ts`、`test/export.test.ts` 及产物 `lib/export.js` + `.js.map` + `.d.ts` + `.d.ts.map`；M `src/zip.ts`（+`createZip`/`readZip`）、`src/remove.ts`、`src/manifest.ts`、`src/types.ts`、`package.json`（仅 test 脚本 +1 个测试文件）、对应 `lib/` 产物与 `lib/types.d.ts`，以及本 CHANGELOG。

**2026-10-02 · Changed · "无 git 源"判据抽成 `hasGitSource`（7 处替换），错误码 `zip-not-updatable` → `not-a-git-clone`；为退役 `source` 字段铺路（行为等价）**

- **背景**：`entry.source === 'zip'` 这一判据此前散在 7 处——`health.ts` 的 check-updates 分流、`switch-version.ts` 的核心守卫、`doctor.ts` 三处（manifest 形状检查的宽松分支 / missing-target 的修复提示 / git-sanity 的 clone 计数）、`http/routes.ts` 两处预检（update 与 switch-version）。它把"能不能 update / switch-version"绑在"来源是不是 zip"上；而 zip 条目与 git 条目的**唯一实质差别是有没有 `gitUrl`**（`src/zip.ts` 安装时写入空 `gitUrl`/`ref`/`commit`）。设计稿 `docs/sources-and-packages.md` §2 因此把"有 git 源"定为唯一判据，本次先落地判据本身（该稿 §8 阶段 2 的第一步），为后续 `export`/`import`/`adopt` 与最终删除 `source` 字段铺路。
- **变更**：`src/manifest.ts` 新增 `hasGitSource(entry)`（`gitUrl.length > 0`）作为判据的单一来源；7 处替换分别为——`health.ts` 的 `if (e.source === 'zip' || e.gitUrl.length === 0)` → `if (!hasGitSource(e))`（等价化简）、`switch-version.ts:110` 的核心守卫 → `if (!hasGitSource(entry)) throw new NotAGitCloneError(name)`、`doctor.ts` 的 `isWellFormedEntry` 宽松分支改由 `gitUrl` 是否为空判定（而非 `source: 'zip'`）、`doctor.ts` 的 missing-target 修复提示改为按 `gitUrl` 分流（无 git 源者提示 remove 而非 update）、`doctor.ts` 的 git-sanity 计数改为 `entries.filter(hasGitSource)`、`http/routes.ts` 的两处预检 → `if (!hasGitSource(entry)) throw new HttpError(400, 'not-a-git-clone', { name })`。错误类 `ZipNotUpdatableError` → `NotAGitCloneError`（消息改为 `has no git source — version switching requires a git clone`），HTTP 400 码 `zip-not-updatable` → `not-a-git-clone` 并**新增负载 `{ name }`**（此前无负载），`src/client/panel.tsx` 的 errorText 同步改文案。
- **行为等价性（本提交的核心论证）**：所有真实 zip 条目（由 `installFromZip` 写入）本就有空 `gitUrl`，故新判据在真实数据上与原判据**逐条等价**；唯一差异是"手工写入的、`gitUrl` 为空且无 `source` 字段"的条目——它们此前被误当作 git 条目（doctor 报 missing-git、`update` 会对非 git 目录发起 git 操作），现在被正确归为无 git 源条目并明确拒绝。这正是设计稿要求"判据替换先行、行为等价"的原因：阶段 3 删除 `source` 字段时将是纯减法。
- **不做**：`source` 字段保留（`src/types.ts`）；`add-zip` 路由、`src/zip.ts` 的安装编排、`list` 载荷中的 `source` 字段与面板 `zip` 徽标**均未改动**——全部留给退役阶段 3。届时**无需数据迁移**：旧条目的 `gitUrl` 已为空，行为天然等同"快照副本"。
- **测试**：`test/api.test.ts` 两处断言改名（update 与 switch-version 路由的 400 码），其夹具**刻意保留真实 zip 条目形状**（`source: 'zip'` + 空 `gitUrl`/`ref`）以证明"旧数据走新判据"；`test/switch-version.test.ts` 用例名与断言类名同步（`core.NotAGitCloneError`）。**用例数量不变**（纯判据替换，不新增判别性用例）。全量 `npm test` **426 条 · 423 通过 · 0 失败 · 3 跳过**（与 S1 前基线逐项一致）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` **退出码均 0**。首轮 `npm test` 曾红一条：`test/doctor.test.ts:321` 断言「无 git 源条目的修复提示不得包含 `update`」，而改写后的提示 `remove <name> (no git source to update from)` 恰含该词（当时 426 · 422 · 1 · 3）。处理方式是**改文案而非放宽断言**——现提示为 `remove <name> (no git source — reinstall from its origin)`，既有断言原样保留，继续守着"不要把用户指向 update"这条产品规则；改后复跑六步全绿。可选负向对照（供复核）：把 `hasGitSource` 临时改为恒 `true` → `test/api.test.ts` 两处 400 断言与 `test/switch-version.test.ts` 的拒绝用例应同时转红。
- **如何辨识改动**：M `src/manifest.ts`（新增 `hasGitSource`）、`src/health.ts`、`src/switch-version.ts`、`src/cli/commands/switch-version.ts`、`src/cli/commands/doctor.ts`、`src/http/routes.ts`、`src/client/panel.tsx`、`test/api.test.ts`、`test/switch-version.test.ts`、本 CHANGELOG，以及重建后的对应 `lib/` 产物。

**2026-10-02 · Changed · remove 语义两侧统一到 v0.3.0 按名字方案：抽出共享核心 `src/remove.ts`，HTTP 路由放弃 Phase 2 归属扫描**

- **背景（复核结论）**：核对历史确认 remove 的删除逻辑**自 v0.3.0 起一字未改**——`git diff v0.3.0 v0.4.0 -- src/cli/commands/remove.ts` 中链接删除段零改动，v0.4.0 只新增 glob/多目标/`--yes`/多技能确认守卫（`link.ts` 甚至不在该 diff 内）。Phase 2 给 HTTP `/remove` 单独实现了「按 readlink 目标归属扫描」，于是同一操作在两侧语义分叉：CLI 按名字推算（看不见手工别名，但保留 v0.3.0 契约），HTTP 按归属（会连带删除别名）。裁决：**两侧统一采用 v0.3.0 老方案**。
- **变更**：新增 `src/remove.ts`（共享核心 `removeSkill(name)`，逻辑自 CLI 的 `removeOne` 原样搬迁）——反注册 → `previewSkills` 推算链接名（单技能用条目名、多技能用 frontmatter 名并以条目名兜底）→ 逐个删除 → 删克隆目录；异常路径兜底删条目名。核心额外用 `isLinked` 记录**实际删除**的链接名，供路由回报 `links` 与判定 `hotReload`。`src/cli/commands/remove.ts` 删除本地 `removeOne` 改调核心（glob/`--yes`/确认/文件锁/消息/退出码全不变）；`src/http/routes.ts` 的 remove 路由删除归属扫描段改调核心（loopback/confirm/双层锁/信封不变；`removeEntry`/`removeSkillDir` 随之不再被该文件使用，已从导入移除）。对齐 `switch-version.ts` 的既有先例：两侧一致由**结构**保证，而非靠人工同步。
- **HTTP 契约**：形状零变化（`{ name, removed, links }` + `hotReload`）；`links` 现在列出**实际删除**的链接名。既有 api 用例（单链接 `['rm-skill']`、无链接 `[]` + `done`）在新实现下原样通过。
- **代价（明示，本次裁决接受）**：手工/外部创建的别名不再被 remove 清理——它按名字推算，看不见这类链接；克隆删除后该别名成为悬空链接，由 `doctor` 的 orphan-link 检查（`dangling-link`，error + 手工清理提示）报告。另注一处沿用不变的行为：目录缺失时 `previewSkills` 返回空数组而非抛错，因此「克隆缺失」不会走兜底、也不会删除任何链接（该兜底实际只在 frontmatter 解析等异常路径触发）。
- **不做**：CLI `update` 缺 zip 分流仅记录（见同日两条提交的「不做」段）；`toggle` 的归属语义零改动（§6.4 裁决继续有效）；`list`/`manifest`/`toggle` 的状态派生仍走 `entryLinks` 归属扫描。
- **测试**：`test/cli-plugin-parity.test.ts` +1 条（remove 段落，该文件共 3 条）——镜像夹具各装一个双技能条目并各加一条**手工别名**，分别经 CLI `remove()` 与 `POST /skills-nexus/remove` 删除：断言两侧删除的链接名一致（`['alpha-ra','beta-ra']`）、克隆目录消失、且**手工别名在两侧都存活**（这正是「按名字而非归属」的判别点）。全量 `npm test` **426 条 · 423 通过 · 0 失败 · 3 跳过**（上一提交基线 425 · 422 · 0 · 3；+1 恰为本轮新增）。既有 `test/remove.test.ts` 10 条与 `test/api.test.ts` 的 remove 用例在新实现下原样通过。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。**负向对照**：临时把 `src/http/routes.ts` 换回 HEAD 的归属实现 → remove parity 转红，实际 `['alias-ra','alpha-ra','beta-ra']` ≠ 期望 `['alpha-ra','beta-ra']`（别名被归属删除），证明该断言真在守两侧语义；恢复后 3/3 全绿。隔离核验：真实 `~/.dsh` 仍为空（0 链接 / 0 克隆 / 无 manifest）。
- **如何辨识改动**：新增 `src/remove.ts` 及产物 `lib/remove.js` / `.js.map` / `.d.ts` / `.d.ts.map`；M `src/cli/commands/remove.ts`、`src/http/routes.ts`、`test/cli-plugin-parity.test.ts`、本 CHANGELOG、`lib/cli/commands/remove.js` + `.js.map` + `.d.ts.map`、`lib/http/routes.js` + `.js.map` + `.d.ts.map`；`lib/cli/commands/remove.d.ts` 与 `lib/http/routes.d.ts` 不变（公开签名未变）；`lib/client.js` 零变化。
**2026-10-02 · Fixed · 插件侧 updateEntryCore 同步按归属清理旧链接；新增 CLI↔插件 parity 测试**

- **背景**：接同日 CLI 提交。CLI 与插件侧是两份镜像实现（`routes.ts` 该函数注释自称 mirroring `update.ts`），按「两侧同一操作必须一致」原则同步修改；插件侧此前同样只调 `linkSkill` 覆盖/新建、**从不清理旧链接**，故上游改名/删除技能时会留下与 CLI 同样的残留（同一 SKILL.md 以两个链接名可见；技能目录消失后链接当场悬空）。
- **变更**：`updateEntryCore` 重建链接改为「记录归属集合 → 逐个 `unlinkSkill` → 按当前 `previewSkills` 重建」；门条件由 `isEntryEnabled(entry)` 换成 `oldLinks.length > 0`（语义等价，扫描由两次减为一次）；被上游移除的名字以一行警告写入 job output；disabled 条目不复活。`isEntryEnabled` 因此在本文件不再被使用，已从导入移除。HTTP 契约零变化（仍 202 + `{ jobId }`；`hotReload` 由客户端既有 `stillListed` 对账承担）。
- **新增 parity 测试**：`test/cli-plugin-parity.test.ts`（2 条，已登记进 `package.json` 的 test 脚本）——同一夹具分别经 CLI `update()` 与 `POST /skills-nexus/update`（202 + job 轮询至 settle）驱动，断言两侧结果链接集合**结构一致**：①上游改名 → 两侧都只留新名、旧名被清理；②上游删至单技能 → 两侧都按「单技能 → 条目名」重新链接，且被删技能的链接消失（不留悬空）。任一侧将来漂移即转红。远端为本地 `file://` 夹具，零网络。
- **不做**：`remove` 路由零改动——其归属语义与 CLI 的统一另作一次提交；`routes.ts` 中 remove 的 `unlinkSkill`（而非 `unlinkIfPointsInto`）随该提交处理；CLI `update` 缺 zip 分流仅记录（同上一条提交「不做」段）。
- **测试**：`test/cli-plugin-parity.test.ts` 新增 2 条；全量 `npm test` **425 条 · 422 通过 · 0 失败 · 3 跳过**（上一提交基线 423 · 420 · 0 · 3；+2 恰为本轮新增）。
- **验证方式**：六步门禁 `typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。**负向对照**：临时换回 HEAD 的 `routes.ts`（不清理旧链接）→ parity 首条转红，实际 `['alpha-api','beta-api','beta-api2']` ≠ 期望 `['alpha-api','beta-api2']`，证明该用例真在守两侧一致性；恢复后 2/2 全绿。隔离核验：真实 `~/.dsh` 仍为空（0 链接 / 0 克隆 / 无 manifest）。
- **如何辨识改动**：M `src/http/routes.ts`、`package.json`（仅 test 一行）、本 CHANGELOG、`lib/http/routes.js` + `.js.map` + `.d.ts.map`；新增 `test/cli-plugin-parity.test.ts`；`lib/http/routes.d.ts` 不变（改动落在私有函数内）；`lib/client.js` 零变化（`git diff --stat -- lib/client.js` 为空）。
**2026-10-02 · Fixed · CLI update 重建链接前按归属清理旧集合（对齐 switch-version 的先删后建；remove 语义零改动）**

- **背景（判断过程）**：起因是复核 remove 的删除语义是否与插件侧一致。逐行比对四条路径的链接命名规则后确认——add（`add.ts:377`）、update（`update.ts:125`）、switch-version（`switch-version.ts:171`）、remove（`remove.ts:143`）**完全一致**（单技能用条目名，多技能用 frontmatter 名并以条目名兜底），即 **remove 删的正是 add 建的那批，v0.4.0 的设计成立**（`removeOne` 的删除段自 v0.3.0 起一字未改，v0.4.0 只新增 glob/多目标/确认守卫）；`remove.ts` 本次零改动。真正的缺口在 **update**：它只调 `linkSkill` 覆盖/新建、**从不清理旧链接**——上游把某技能改名时旧名链接留存（同一 SKILL.md 以两个链接名可见），上游删除某技能目录时旧名链接**当场悬空**（doctor 报 `missing-target` / `dangling-link`）；且随后的 remove 按当前克隆推算名字，同样看不见这些残留，克隆一删即成悬空链接。
- **变更**：`src/cli/commands/update.ts` 重建链接改为「记录归属集合 → 逐个删除 → 按当前 `previewSkills` 重建」——先 `entryLinks(s)` 取回本条目克隆内全部链接（含名字已漂移者），逐个 `unlinkSkill`，再按 `skills.length === 1 ? s.name : (fmName || s.name)` 重建；重建门条件由 `isEntryEnabled(s)` 换成 `oldLinks.length > 0`（语义等价，扫描由两次减为一次）。被上游移除的名字以一行警告列出（`⚠ dropped N stale link(s) no longer provided upstream: …`）。disabled 条目（无归属链接）不得被静默重新启用——与 switch-version 第 6 步同一不变式。`update.ts` 导入相应增加 `entryLinks` / `unlinkSkill`。
- **已知副作用（明示）**：多技能仓库缩为单技能后，幸存者按「单技能 → 条目名」规则重新链接（实测为条目名），旧名链接被清理而非与旧名并存；该命名规则本身未变，本次只让它成为唯一链接。
- **不做**：`remove.ts` 语义零改动（命名规则本就对称，§6.4 裁决继续有效）；`src/http/routes.ts` 本次未动（插件侧紧随其后单独提交）；CLI `update` 缺 zip 分流一事仅记录——`switch-version` 的 zip 守卫位于共享核心（`switch-version.ts:110`）故两侧天然一致，而 `update` 的 `zip-not-updatable` 只在 HTTP 路由里，CLI 侧无对应守卫（裸 `update` 遇启用 zip 条目会对非 git 目录发起 git 操作）。
- **测试**：`test/update.test.ts` 12 条（+3）——多技能仓库上游改名后旧名链接被清理（判别性）；上游删除技能目录后旧名链接消失、`entryLinks` 集合恰为重建结果（判别性）；链接被清空（disabled）的条目在 update 后仍无任何链接（不变式）。新夹具 `makeBundledRepo` 为**单层** `<root>/<name>/SKILL.md` 布局（既有 `makeCollectionRepo` 是嵌套 `skills/<name>/`，整仓安装产出 0 个技能，只能配 `--subdir`），且每个用例使用独立技能名——同一夹具 home 内链接会跨用例残留。另修一处测试隔离隐患：静态 import 会在 `before()` 设置 `DSH_HOME` 之前求值 `paths.ts`，曾使整份套件写入真实 `~/.dsh`；`link` 改由 `before()` 内动态导入，并新增断言闸门（`paths.OFFICIAL_SKILLS_DIR` 必须以夹具 home 开头）。全量 `npm test` **423 条 · 420 通过 · 0 失败 · 3 跳过**（基线 420 · 417 · 0 · 3；+3 恰为本轮新增用例）。
- **验证方式**：六步门禁 `npm run typecheck` / `lint` / `test:build` / `build` / `build:client` / `npm test` 退出码均 0。**负向对照**（证明判别性用例非形同虚设）：`git checkout HEAD -- src/cli/commands/update.ts` 换回旧实现后聚焦复跑两条判别性用例 → **双双转红**（断言 `isLinked(旧名) === false` 实测为 `true`）；恢复新实现后 12/12 全绿。隔离核验：聚焦与全量两轮跑完，真实 `~/.dsh/skills` 0 项、`~/.dsh/skills-nexus/repos` 0 目录、无 manifest（P0 审计另以 TypeScript 编译器 API 精确核对 26 个测试文件：静态 import 链触达 `src/paths.ts` 者 0 个，既有套件本身干净）。
- **如何辨识改动**：`git status --short` 应为 M 5——`src/cli/commands/update.ts`、`test/update.test.ts`、本 CHANGELOG、`lib/cli/commands/update.js`、`lib/cli/commands/update.js.map`（另 `lib/cli/commands/update.d.ts.map`）；`lib/cli/commands/update.d.ts` 不变（公开签名零变化）；`lib/client.js` 零变化（`git diff --stat -- lib/client.js` 为空）；插件侧代码与 HTTP 契约零变化。

**2026-09-28 · Changed · CLI disable 归属语义切换（§6.4 裁决，Phase 5 独立行为变更提交）：toggle disable 由「按名字删」（previewSkills 算链接名逐个 unlink + 多技能 entry.name 兜底）改为「按 readlink 目标归属删」（扫描技能根，逐链接判目标是否落在本 entry 克隆内）；归属判据收敛为 link.ts 单一实现（pointsInto，entryLinks 与新函数 unlinkIfPointsInto 共用）；disable 不再依赖 clone 完好（顺手修复 clone 缺失时静默假成功）**

- **背景**：方案 §6.4 二轮修订 #6 裁决的 Phase 5 部分：HTTP/UI 侧 toggle 在 Phase 2 已直接按目标归属实现，CLI 侧本次单独提交切换到同一语义（§6.1「行为保持」承诺仅约束到本提交之前）。用户裁决路径：feat/plugin-side 合并 master 后，切换作为 master 上的独立提交，实测后决定落地与否。前置对照实测（分支上四场景探针）已证明：两语义在常规场景（含 --name、--subdir、多技能齐全）逐字节一致，分歧仅在边界场景——手动别名（按名字删残留链接且 isEntryEnabled 语义分裂）与 clone 损坏（按名字删静默假成功：exit 0 + 0 removed + 链接残留）。本提交即切换全部产物。
- **变更（link.ts）**：归属判据提取为模块内 `pointsInto(resolved, base)`（等于 base 或在其内部，目录边界带 sep）——原 entryLinks 内联判据（`resolved === base.slice(0, -1) || startsWith(base)`）的逐字等价提取，「链接归属谁」自此单一来源；新增 `unlinkIfPointsInto(linkPath, dir)`：lstat 非 symlink 或缺失返回 false 不动文件，readlink 后 resolve（以链接所在目录为基准）判 pointsInto，命中则 unlink 返回 true——缺失/非链接/他人克隆三种情况零副作用。entryLinks 改用 pointsInto（行为零变化）；unlinkSkill/isEntryEnabled/linkSkill 等其余函数零改动。
- **变更（toggle.ts）**：disable 分支重写——readdir 官方技能根（缺失容忍空数组）→ 逐名 `unlinkIfPointsInto(skillLinkPath(name), dir)` 计数；不再调 previewSkills（disable 不再依赖 clone 完好，亦不再受 frontmatter 名字规则约束——别名链接一并归属删除）；多技能的 entry.name 兜底 unlink 随之取消（归属扫描天然涵盖指向本克隆的任意名字）。enable 分支零变化；toggle() 主函数、锁路径（withSkillFileLock）、早退守卫（isEntryEnabled）、输出行格式（`Disabled "x" — N symlink(s) removed`，N 语义改为归属删除数）均不变。
- **变更（toggle.test.ts，§6.4 点名解冻）**：既有 3 条用例断言零修改（常规场景两语义一致，探针已证）；makeMultiSkillRepo 参数化技能名（默认 one/two/three 不变，既有调用零影响）；新增 3 条判别性用例——手动别名（删掉正规链接、junction 重建指向本克隆的 alias-one → disable 后别名随正主一并删净且 isEntryEnabled 归 false）；clone 缺失（add 后删克隆目录 → disable 仍删净全部链接——旧实现此时 previewSkills 空转、0 removed 假成功）；不误删他人（单技能新 entry disable 后，另一 entry 的三条链接原样——归属判据负向）。新用例技能名带前缀（a-/g-）避免 linkSkill 同名替换劫持其他用例的链接（首版踩坑实录：同 one/two/three 名字的 add 会静默替换前序用例的链接指向）。
- **不做**：`remove.ts` 不在 §6.4 裁决范围（方案明文：Phase 1-4 的 CLI remove 行为保持，仅 toggle 切换）；`src/http/routes.ts` 零改动——HTTP 侧 disable 自 Phase 2 已是归属语义（entryLinks + unlinkSkill），判据经 pointsInto 共享后两侧语义单一，36 条 api 测试原样覆盖；manifest schema、HTTP 契约、enable 路径、锁行为零变化；`test/toggle.test.ts` 第二条用例（bare update 默认目标）的幽灵登记 quirk 不在本提交修（见过程记录，属既有现象）。
- **测试**：toggle.test.ts 3 → 6 条（+3 恰为新增边界用例）；全量 `npm test` **420 条 · 417 通过 · 0 失败 · 3 跳过**（基线 417，+3；跳过同基线）。
- **验证方式**：六步门禁 `npm run typecheck` / `npm run lint` / `npm run test:build` / `npm run build` / `npm run build:client` / `npm test` 退出码均 0。**负向对照**（证明新用例非形同虚设）：临时把 src/cli/commands/toggle.ts 回退到 HEAD 的按名字删版本，聚焦复跑 toggle.test.ts → **5 条 · 3 过 · 2 红**，红恰为 alias（exists 断言 true !== false——别名残留）与 gone（`Disabled "src-gone" — 0 symlink(s) removed` 假成功、链接残留）两条判别性用例，绿为常规多技能、list、不误删他人（两语义共有行为）；恢复新实现后 5/5 全绿。**四场景实机探针**（隔离 DSH_HOME）：--name——add --name custom-name 后链接名即 custom-name，disable 删净、enable 恢复往返干净；--subdir——双条目（--name repo-d-a / repo-d-b 各自独立克隆 repo-d-a/repo-d-b）disable repo-d-a 后 a 链接删净、b 链接与 enabled 状态无伤。别名与 clone 损坏两场景由新单测覆盖且负向对照已证判别性。
- **过程记录**：本轮着重测试中发现 `test/toggle.test.ts` 第二条用例（multi-skill entry is included in the bare update default targets）自引入起即为**幽灵测试**：模块加载时注册、回调代码执行（update/disable 流程输出在案）、断言静默通过，但 node:test runner 不将其计入统计（tests 计数缺一）——即其断言若将来失败也不会被 npm test 报红。已验证与名字无关、与声明位置相关（移至文件末尾即恢复登记）；master 基线即如此（非本次引入），按冻结文件「不混入其他改动」约束不在本提交修，建议后续单独提交处理。
- **如何辨识改动**：`git status --short` 共 11 个条目——M 11（`src/` 2：`link.ts`、`cli/commands/toggle.ts`；`test/` 1：`toggle.test.ts`；本 CHANGELOG 1；`lib/` 产物 7：`link.js`/`.js.map`/`d.ts`/`.d.ts.map` + `cli/commands/toggle.js`/`.js.map`/`.d.ts.map`——`toggle.d.ts` 未变因公开签名零变化）；无新增/删除文件；`src/http/`、manifest schema、CLI 其余命令与 `.github/workflows/` 零变化。

**2026-09-28 · Docs · 插件侧 Phase 5 文档收口（不含发布）：双语 README 新增「Web 面板（插件侧，可选）」章节并清理与插件侧现实脱节的旧描述（no-op apply、缺 switch-version、「必须重启」）；CONTRIBUTING 双语同步至插件侧全量模块（结构树重写 / 门禁清单补 test:build 与 build:client / 测试映射表补六行）；npm 发布与 GitHub 推送按用户指示暂缓**

- **背景**：按插件侧设计方案 §13.3 Phase 5 的文档部分实施（归属语义切换与发布事项除外）。用户裁决：npm 发布与 GitHub 推送暂缓；CLI disable 归属语义切换（§6.4）移至本分支合并 master 后的独立提交（先实测再决定落地）。Phase 4 提交（a8ef881）后文档与插件侧现实存在多处脱节：README 插件段仍写「`apply()` 为空实现」、Usage 缺 `switch-version` 命令行、本地测试 Step 5 仍称「必须重启」（与 Phase 0 探针 3 实测的热加载结论矛盾）、CONTRIBUTING 结构树停在 Phase 0 前形态（缺 client/、http/、ops-io、locks、switch-version、zip、health、update-cache 及 cli 子目录三个文件）、门禁清单缺 `test:build` 与 `build:client`、测试映射表缺六个新模块。本提交即 Phase 5 文档部分全部产物。
- **变更（README 双语）**：`README.md` / `README_CN.md` 七处成对修改——「注册为 DSH 插件」段改为「web 会话会带上 Skills Nexus 设置面板及其 `/skills-nexus/*` HTTP 路由；非 web 宿主该层保持沉默」（替换 no-op apply 旧描述）；Usage 代码块补 `switch-version` 行；新增「Web 面板（插件侧，可选）」章节：面板与 CLI 驱动同一份 manifest、同一批克隆与同一套跨进程文件锁（两边可随意混用、busy/locked 互答）、面板能力四条（条目卡片 / add 与 zip 上传 / 启停更新切换删除含 confirm 流 / 长操作进度与取消及全量检查更新）、热加载段（watcher 拾取、稳定窗口内生效、无 watcher 宿主明说下次启动生效）、内部 HTTP 接口段（GET/POST 路由清单、信封方言、同源与 loopback 校验、非稳定机器接口警告——工具开发者继续 shell out CLI）；「可选：注册为 DSH 插件」的插件层注记同步提及面板；本地测试 Step 3 提及 Settings 页面板；Step 5 由「必须重启」改写为「默认无需重启（watcher 热加载，开新对话验证）+ 重启兜底」；Notes 的「add 后是否立即可见」条目同步软化。中文版另修正错字「兑底→兜底」。
- **变更（CONTRIBUTING 双语）**：项目结构树重写至与 `src/` 现状对齐——`index.ts` 注释改为「在 web 宿主中惰性注册 /skills-nexus/* 路由」、`cli/` 补 `glob.ts` / `progress.ts` / `prompt.ts` 且 commands 列出全部八个命令、新增 `client/`（index.tsx / api.ts / panel.tsx）与 `http/` 与 `ops-io.ts` / `locks.ts` / `switch-version.ts` / `zip.ts` / `health.ts` / `update-cache.ts` 六个顶层模块、`link.ts` 注释补「按目标归属扫描」、`manifest.ts` 补 `listEntries`、`paths.ts` 补 locks、`git.ts` 补 fetch；运行时依赖段同步重写（web 宿主惰性注入 + 非 web 沉默 + skill 发现从不依赖插件层）。质量门禁清单补 `npm run test:build` 与 `npm run build:client` 两行，并新增说明段：`build:client` 刻意不并入 `npm run build` 或 CI——tsdown 引擎门槛（Node ^22.18 || >=24.11）超出支持矩阵的 Node 20 入口，客户端 bundle 在足够新的 Node 上本地构建后随 `lib/` 提交（与 Phase 0 决策一致）。测试映射表补六行（`ops-io` / `zip` / `switch-version` / `locks` / `http` 路由 / `client/api`），`test/` 全部 26 个测试文件至此全部入表。
- **不做**：npm 发布与版本号变更（用户指示暂缓，Unreleased 不收口为版本节）；GitHub 推送（继续仅本地提交）；CLI disable 归属语义切换（§6.4）——按用户裁决移至合并 master 后的独立提交，前置四场景对照实测已完成：手动别名残留（按名字删残留链接且 `isEntryEnabled` 与 CLI 宣称分裂）、clone 损坏（按名字删静默假成功——exit 0 + 0 removed + 链接残留；按归属删不依赖 clone 存在、可正确清理）为两语义仅有的分歧点，`--name` 与 `--subdir` 场景两语义逐字节一致（用户最担心的两个冲突面实测排除）；`ci.yml` 零改动——已核实「Verify committed lib/」检查跑在 `npm run build`（tsc，不含客户端 bundle）之后，`lib/client.js` 与 `lib/client-types/` 不被 tsc 触碰、diff 恒干净，现有检查与插件侧产物天然兼容，CI 段落描述无需变更。
- **验证方式**：纯文档改动，未触碰任何被测路径——`git status --short` 恰 5 个 M（四文档 + 本 CHANGELOG），`src/`、`test/`、`lib/`、`.github/`、`package.json` 零变化，六步门禁结果与 a8ef881 基线（417 条 · 414 通过 · 0 失败 · 3 跳过）一致无需重跑；双语两版逐节对照——章节标题、内部锚点链接（英文 `#web-panel-optional-plugin-side` / 中文 `#web-面板插件侧可选`）与门禁/表格行数一一对应；CONTRIBUTING 的 CI 段描述与 `ci.yml` 实际步骤逐条核对；README 新章节的路由清单、信封方言、同源/loopback 语义与 Phase 2/4 的实现逐一对照。
- **如何辨识改动**：`git status --short` 恰 5 个 M——`README.md`、`README_CN.md`、`CONTRIBUTING.md`、`CONTRIBUTING.zh-CN.md`、本 CHANGELOG；无新增/删除文件；代码、测试、构建产物与 CI 配置零变化。

**2026-09-28 · Added · 插件侧 Phase 4 热加载三态闭环：服务端 hotReload 按「是否真的动过链接」收敛（remove/toggle 的空操作回 done）、api 客户端新增 §11 对账 `reconcileList`（轮询 list 至可见、2s 预算、超时携带最后快照）、面板接线（pending→对账 / done→单次刷新 / unsupported→下次宿主启动降级文案 / 超时→手动刷新提示）；零路由契约变更 + 6 条新用例**

- **背景**：按插件侧设计方案 §13.2 表的 Phase 4「热加载三态 + pending 轮询 + 降级文案」（0.5 天）实施。§11 语义：`pending` = 链接已建/删、宿主 watcher 尚未确认生效，UI 轮询 `list` 直到变化可见、超时（2s）提示手动刷新；`done` = 不触发 watcher 的操作；`unsupported` = 宿主无 watcher 或链接类型异常时的降级文案。约定不变：单条功能分支 `feat/plugin-side`、每 Phase 验收后本地原子提交（不 push）。本提交即 Phase 4 全部产物。
- **变更（服务端三态收敛）**：`src/http/routes.ts`——remove 路由的 hotReload 由硬编码 `'pending'` 收敛为 `removedLinks.length > 0 ? 'pending' : 'done'`（§11：只有真正删除链接才唤醒宿主 watcher；无链接的删除是空操作）；`toggleEntryCore` 返回值新增 `changed: boolean`（仅当真实执行 linkSkill/unlinkSkill 时为 true），toggle 路由解构剥离后按 `changed ? 'pending' : 'done'` 输出——两处响应 data 契约均不变（toggle 仍为 `{name, enabled, links}`）。不新增 `unsupported` 发射路径，理由如注：宿主 watcher 状态在 nexus 进程内不可探测（dsh-skill-filesystem v0.1.1-rc.2 无公开 watch 状态 API），且 nexus 自建链接必为 junction（`linkSkill` 一律 `symlink(…, 'junction')`、collision 守卫挡非 symlink），「链接类型异常」在自身路径不可达——`unsupported` 保留为防御性契约（客户端渲染已支持），实际降级由 2s 超时提示承担（#23 裁决：收窄为异常路径提示）。
- **变更（api 客户端）**：`src/client/api.ts`——新增 `reconcileList(api, until, opts)`：§11 对账轮询，poll `list` 至谓词接受快照（默认 250ms 间隔 / 2s 超时预算；sleep/onTick 可注入，仿 pollJob 模式）；超时抛 `ReconcileTimeoutError` 且携带最后快照——UI 据此保留现场并提示手动刷新，不丢信息。注记：list 响应直接派生自文件系统真相（manifest + readlink 扫描），正常路径 1 次即满足；轮询预算用于宿主持久化稳定窗口与并发竞态的防御。
- **变更（面板接线）**：`src/client/panel.tsx`——`reconcileAfter(label, hotReload, until)` 成为全部变更操作的对账漏斗：`pending`（或字段缺失的防御分支）→ `reconcileList` 轮询（onTick 渐进更新列表；超时 → 保留最后快照 +「change not reflected yet — refresh manually shortly」）；`done` → 单次 refresh；`unsupported` → 降级文案「applied on disk — this host cannot hot-reload links, so it takes effect on the next host start」+ refresh。四个谓词函数：remove → 条目消失（`goneFrom`）；toggle → enabled 翻转至目标（`flipsTo`）；add/add-zip → 出现操作前名字基线之外的新名（`appearsNewName`）；update/switch-version → 条目仍存在（`stillListed`，sanity 检查——其可见变化是 commit 字段且 no-op 成功时不变，严格谓词会假超时，局限已在注释说明）。`track` 扩展第三参 `until`：job settle 为 done 后走对账，error/cancelled 仅刷新；删除 Phase 3 的接缝函数 `refreshAfterMutation`。
- **不做**：不新增 `unsupported` 服务端发射（不可探测 + 不可达，见上）；不改任何路由的信封与字段契约（仅 remove/toggle 的 hotReload 取值收敛）；面板组件级渲染测试仍不新增（api 层单测 + 实机验收，同 Phase 3）；list 响应、manifest schema、CLI 零变化；CLI toggle 归属语义切换仍属 Phase 5（toggle.test.ts 冻结）。
- **测试**：`test/client-api.test.ts`（+3 条，共 23 条）——reconcileList 三态：首快照即满足（仅 1 次 list 请求）、轮询至满足（3 次请求、2 次 onTick 逐次上报、返回满足快照）、超时抛 ReconcileTimeoutError 携带最后快照（`timeoutMs: 0` 负向参数，仿 pollJob 超时测试模式）；`test/api.test.ts`（+3 条、1 条补断言，共 36 条）——remove 无链接回 `done`、no-op disable（无链接）回 `done`、no-op enable（链接已齐）回 `done`，另有链接场景的 toggle enable 补 `pending` 断言（原有 remove/disable 两条 `pending` 断言在新逻辑下原样通过）。全量 `npm test` **417 条 · 414 通过 · 0 失败 · 3 跳过**（基线 411 条，+6 恰为本轮全部新用例；跳过同基线）。
- **验证方式**：六步门禁 `npm run typecheck` / `npm run lint` / `npm run test:build` / `npm run build` / `npm run build:client` / `npm test` 退出码均 0；`build:client` 重建 `lib/client.js`（22.00 → 25.97 kB / gzip 6.60 → 7.61 kB）。聚焦验证 `node --import tsx --test test/api.test.ts test/client-api.test.ts` → **59 条 · 59 通过**（36 + 23）。负向对照（实证服务端收敛断言非形同虚设）：把 remove/toggle 两处临时改回硬编码 `'pending'`，同文件复跑 **33 通过 · 3 失败**——红恰为三条 no-op `done` 断言（remove without links / no-op disable / no-op enable），有链接的三条 `pending` 断言在两版逻辑下同为绿；复原后 36/36 恢复全绿。
- **如何辨识改动**：`git status --short` 共 15 个条目——M 15（`src/` 3：`http/routes.ts`、`client/api.ts`、`client/panel.tsx`；`test/` 2：`api.test.ts`、`client-api.test.ts`；本 CHANGELOG 1；`lib/` 产物 9：`http/routes.js`/`.js.map`/`.d.ts.map` + `client.js`/`.js.map` + `client-types/client/` 的 `api.d.ts`/`.d.ts.map`/`panel.d.ts`/`.d.ts.map`）；无新增文件；`lib/http/routes.d.ts` 未变（toggleEntryCore 为私有函数，公开声明零变化）；list 响应、manifest schema、CLI、`.github/workflows/` 零变化。

**2026-09-28 · Added · 插件侧 Phase 3 客户端 UI：Settings「Skills Nexus」真实面板（条目卡片 / add 表单 / 任务进度 / confirm 流）与类型化 api 客户端（11 方法，含 confirmable 与 pollJob）；主构建划出 `src/client` 边界；零服务端行为变化 + 1 个新测试文件 20 条**

- **背景**：按插件侧设计方案 §13.3 的 Phase 3 实施：把 Phase 0 的探针半边（一行文本）换成 §10.4 的真实面板，数据全部经 Phase 2 的 `/skills-nexus/*` 路由；浏览器半边沿用 Phase 0 已实测的模块形状（`name`/`inject`/`apply`）与构建链（§10.3 两步 `build:client`）。约定不变：单条功能分支 `feat/plugin-side`、每 Phase 验收后本地原子提交（不 push）。本提交即 Phase 3 全部产物。
- **变更（api 客户端）**：`src/client/api.ts`（新，282 行）——§10.1 类型化客户端：单一 fetch 包装按 §7.1 方言解包 `{data, hotReload}`、失败抛 `ApiError`（status + error code + data）；11 个方法覆盖 list/doctor/add/add-zip（FormData）/remove/update/check-updates/switch-version/toggle/job/cancel；`confirmable()` 把 §12.2 的 `409 confirm-required` 包成「问后重试」流（question 以服务端为单一措辞来源；用户拒绝则 resolve `undefined` 且零重试）；`pollJob()` 按 §7.5 轮询至离开 running（默认 1s 间隔 / 10 分钟上限；超时抛携带最后快照的 `PollTimeoutError`——任务在服务端继续，可放弃轮询而不丢任务）；transport 声明为可注入的窄结构类型（真实 `fetch` 天然满足）——整模块在 Node 里可无服务器、无网络单测。
- **变更（面板）**：`src/client/panel.tsx`（新，506 行）——§10.4 面板：条目卡片（name / url·subdir（zip 条目显 zip）/ 启用态 / 链接清单逐条 ✓·✕ / `update available → <7 位短 sha>` 徽标）、add 表单（git url + zip 上传）、refresh 与 check updates、卡片动作（enable/disable、update、pin to… + switch、remove）；异步命令走 §7.5 任务通道（202 受理 → 800ms 轮询；running operations 区显示 stage/detail/输出末尾并带 cancel；settle 后刷新列表，末 3 条落 recent operations）；同步 remove/toggle 走 confirmable；错误按 §7.1 错误码映射为单行可读文案（busy/locked/already-registered/collision/zip-not-updatable/ref-not-found/not-found/untrusted origin）；`hotReload:'pending'` 当前触发立即刷新列表（§11 轮询对账属 Phase 4，接缝 `refreshAfterMutation`）；样式有意保持结构化（语义元素、零样式表依赖），对接宿主 UI 原语留作后续打磨。
- **变更（接线与构建边界）**：`src/client/index.tsx`——设置段正文由探针文本换成 `<NexusPanel/>`，模块形状零变化；`tsconfig.json` 主构建 exclude 增加 `src/client`（服务端 tsc 不再编浏览器半边；其打包与类型仍由 `build:client` 的 tsdown + `tsconfig.client-types.json` 两步负责，两文件本轮零改动）。
- **不做**：hotReload `pending` 的轮询对账（§11，Phase 4）；面板视觉对接宿主 UI 原语（当前语义元素 + 原生 `window.confirm`——§10.4「文案明示后果」由服务端 question 满足）；面板组件级渲染测试（本阶段测试面为 api 客户端，面板走实机验收）；不改任何服务端路由、CLI 命令与 manifest schema；`build:client` 仍不并入 `build`（引擎门槛与 CI 矩阵决策同 Phase 0 说明，留待 Phase 5）。
- **测试**：`test/client-api.test.ts`（新，20 条）——录制式 fake fetch 全离线：信封解包与 hotReload、202 严格信封、错误方言（409 confirm-required / 非 JSON invalid-response / 缺 data invalid-envelope / 未知码 unknown-error 降级）、请求形状（add JSON+content-type、remove/update 的 confirm 默认 false 与显式 true、toggle、switch-version 全字段、job id URL 编码、add-zip FormData 携带文件名、cancelJob）、confirmable 三态（接受后 confirm:true 重试、拒绝零重试、其他错误原样传播）、jobConfirmationQuestion 标记提取、pollJob 三态（行走→settle 且逐 tick 上报、cancelled 不抛、超时抛携带快照的 PollTimeoutError）。全量 `npm test` **411 条 · 408 通过 · 0 失败 · 3 跳过**（跳过同基线；基线 391 条，+20 恰为本文件）；test 脚本 25 → 26 文件。
- **验证方式**：六步门禁 `npm run typecheck` / `npm run lint` / `npm run test:build` / `npm run build` / `npm run build:client` / `npm test` 退出码均 0；构建重建产物齐备（`lib/client.js` 22.0 kB / gzip 6.6 kB + map；`lib/client-types/client/` 生成 api/panel 两组声明及 map）。实机验收（Windows、dsh 0.1.5-rc.3、隔离 `DSH_HOME` + overlay 挂载本仓产物）九步全过：步骤 1-5 面板渲染与稳定性、refresh、disable↔enable 往返、remove 原生确认取消后条目保留（截图佐证）；步骤 6 remove + 原生确认 → 条目连同链接与管理克隆删净；步骤 7 add 表单加回条目 → 202 受理 → running 进度一闪 → 卡片重现（enabled、链接 ✓、commit 锁定）；步骤 8 check updates 无错误提示且条目落 `update.checkedAt`；步骤 9 console 无 error（修复前的 `ERR_INSUFFICIENT_RESOURCES` / `Failed to fetch` 风暴不再出现）。过程记录两处：其一，面板初版把 `createApi()` 写为组件默认参数——逐渲染新建实例使 list 副作用自激（实机观测为连接池耗尽式 fetch 风暴），改为挂载期惰性 `useState` 钉住实例（prop 保留测试注入接缝）；其二，验收宿主进程的子进程创建权限是前提——受限环境（宿主内 spawn 被禁）中 `add` 在 git 克隆阶段报 `spawn EPERM`，独立探针插件实证为环境限制而非插件缺陷（同环境普通 node 进程 spawn git 正常、CLI 全程正常；该轮失败顺带实证了任务失败在 UI 的呈现路径：202 → running → error → `recent operations ✕ add · <name> — <error>`），换至非受限环境后九步一次通过。
- **如何辨识改动**：`git status --short` 共 15 个条目——M 8（`src/client/index.tsx`、`tsconfig.json`、`package.json`、本 CHANGELOG、`lib/` 4：`client.js`/`client.js.map` + `client-types/client/index.d.ts`/`.d.ts.map`）+ 新文件 7（`src/` 2：`api.ts`/`panel.tsx`；`test/` 1；`lib/client-types/client/` 4：`api.*`、`panel.*` 各 `.d.ts`/`.d.ts.map`）；其中 `package.json` 仅 test 清单登记新测试文件、`tsconfig.json` 仅 exclude 一行；服务端 `src/`、`lib/` 服务端产物、manifest schema、CLI 与路由行为零变化。

**2026-09-28 · Added · 插件侧 Phase 2 全量 HTTP 路由与三层并发锁：`/skills-nexus/*` 12 条路由（统一信封 / 405+allow / 同源与 loopback 守卫 / 409 confirm-required）、长操作任务通道（202 受理即锁 + GET /job 轮询 + 尽力取消）、跨进程 O_EXCL 文件锁接线五个 CLI 写命令、doctor 的 zip 分流与 external-disabled 检查、webServer peerDependency；零既有 CLI 行为变化 + 3 个测试文件 53 条**

- **背景**：按插件侧设计方案 §13.2 的 Phase 2 实施：把 Phase 1 的核心（`switchVersion` / `installFromZip` / `checkUpdates` / `listEntries` / OpsIO 接缝）接成 §7.1 的 12 条 `webServer` 路由，落地 §7.3 三层并发锁、§7.5 任务通道、§12 安全守卫与 §6.2/§9.3 的 doctor zip 分流。约定不变：单条功能分支 `feat/plugin-side`、每 Phase 验收后本地原子提交（不 push）；本提交即 Phase 2 全部产物。
- **变更（路由层）**：`src/http/`（新，5 源文件）——`types.ts`（RouteRequest/RouteResponse/RouteSpec 结构类型 + `PLUGIN_ID` 单一来源 + `HttpError`）；`util.ts`（统一信封 `{data, hotReload}` / `{error, data}`、`requireMethod` 405+allow、`sameOrigin`（缺 Origin 放行、声明不符 403）、`isLoopback`、`readBody`（413 上限）/`readJson`）；`jobs.ts`（§7.5 Job Map：id/kind/name/status/stage/detail/output≤200 行/error/起止时刻，运行期不持久）；`io.ts`（`jobIO`：progress/emit 在每次 io 边界检查取消标记、confirm 一律 `NeedsConfirm` 逃生舱；`quietIO` 供同步路由）；`routes.ts`（757 行，12 条路由 + 三个核心编排（installGitCore/updateEntryCore/toggleEntryCore）+ 手写 multipart 单文件解析）。路由语义：ping/list/doctor/job 只读 GET（hotReload `done`）；add/update/switch-version/add-zip 202 任务化（预检在受理前：重复登记 409 already-registered、目标名碰撞 409 collision、zip 条目 400 zip-not-updatable；202 信封严格为 `{ data: { jobId } }`）；remove/toggle 同步返回 `pending`（remove：loopback + confirm 409 + 按 readlink 目标删全部 N 链接；toggle：§6.4 目标归属语义——disable 删全部、enable 只补缺失 + 碰撞守卫 409）；check-updates 全局缓存锁；全部变更/联网路由同源校验。
- **变更（三层锁与 CLI 接线）**：`src/locks.ts`（新，215 行）——层1 per-skill 进程内单飞（busy→409 busy）+ `tryClaimSkillFlight`（同步抢占，受理即锁：202 前先判 busy）+ 层2 全局缓存锁（check-updates 写与 list 读串行）+ 层3 跨进程 `O_EXCL` 文件锁 `<NEXUS_HOME>/.locks/<name>.lock`（{pid,startedAt}；死 PID / 超 10 分钟 / 内容不可读 → 回收重试一次；否则 409 locked）；accept() 顺序 flight → 文件锁 → 建 Job → `202 { data: { jobId } }` → 后台执行、`finally` 一次性释放两锁（文件锁失败时回滚抢占防泄漏）。add/update/remove/toggle/switch-version 五个 CLI 写命令同接三层锁（`SkillLockedError` → stderr + exit 1）；`src/paths.ts` 新增 `LOCKS_DIR`。
- **变更（doctor 分流与外部禁用治理）**：`isWellFormedEntry` 对 zip 条目放宽（仅校验 name/url/path/addedAt）；`checkGitSanity` 跳过 zip（detail 只计 git 克隆）；新增 `checkExternalDisabled`（扫描 `.disabled` 类外部禁用标记，budget 2000 / 上限 20 / 剪 `.git`，无 fix 提示），按 §6.2 位置契约追加在 checks 尾部（保护 stable report v1 既有位置）。
- **变更（入口与依赖）**：`src/index.ts` 重写——仍 `inject = []`，`ctx.inject(['webServer'])` 内改为遍历 `createNexusRoutes()` 逐条 `ctx.effect(register, label)`（热重挂载先注销后重注册，避免重复 (kind,path) 崩溃）；`name` 改为从 `PLUGIN_ID` 重导出（单一来源）。`package.json` 新增 `peerDependencies`：`@deepseek-ai/dsh-host-webserver: "*"`（§7.4 硬点 2），并以 `peerDependenciesMeta.optional: true` 声明为可选（该宿主包为私有分发，非 optional 会让 npm 试图从公共 registry 拉取而失败；惰性注入语义本就允许非 web 宿主缺席）；`package-lock.json` 同步（+8 行）。
- **不做**：CLI 命令输出格式零变化（锁失败新增 stderr 一行 + exit 1 除外，属 §7.3 新能力）；HTTP toggle 不迁移 CLI toggle（§6.4 裁决：Phase 5 统一，toggle.test.ts 冻结）；客户端 UI（Phase 3）；不做 AbortSignal 级 git 取消（§7.5 尽力而为，io 边界生效）；路由核心不复用 CLI 命令（stderr 直写与 argv 层留待后续阶段收敛，注释已注明）。
- **测试**：新增/扩展 3 个文件 53 条——`test/api.test.ts`（新，33 条）fake req/res 直驱路由：信封与 405+allow、list 空态与派生链接态、doctor stable report（前 6 位 + external-disabled 居尾）、remove/toggle 全语义（confirm 409 → 200、同源/loopback 403、目标归属多链接删除、enable 只补缺 + 碰撞 409）、add 预检三态、update/switch-version 的 zip 拒绝与 busy/locked 409 方言、check-updates 同源 403（零网络）、add-zip multipart → 202 严格信封 → 轮询 done → manifest source=zip + 链接落盘，任务通道确定性三例（取消在 io 边界生效、needs-confirm 错误、release 恰好一次）；`test/locks.test.ts`（新，12 条）三层锁矩阵（O_EXCL 写入与释放、活锁拒绝、死 PID/超时/坏文件回收、名字净化、异常也释放、flight 单飞与清理、缓存锁串行）；`test/doctor.test.ts`（+8 条）zip 形状放宽、git-sanity 全跳过、混合清单只计 git、zip 缺失目标提示重装、--updates 沉默、marker 无 fix、嵌套扫描剪 .git、checks 顺序尾部。测试零网络：网络核心只走预检分支。全量 `npm test` **391 条 · 388 通过 · 0 失败 · 3 跳过**（跳过同基线，为 sparse 环境门控/补全用例）；test 脚本 23 → 25 文件。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 退出码均 0；`npm run test:build`（覆盖 `test/`）退出码 0；`npm install --package-lock-only` 同步 peer 声明；build 后 `lib/http/` 20 产物 + `lib/locks.*` 4 产物生成，路由层首轮 typecheck/lint 即全绿。
- **如何辨识改动**：`git status --short` 除未跟踪残留 `.tmp-gitfetch-exp/`（历史实验空目录，未触碰）外共 75 个条目——M 43（`src/` 9 + `test/` 1 + `package.json` 1 + `package-lock.json` 1 + 本 CHANGELOG 1 + `lib/` 30）+ 新文件 32（`src/` 6：`locks.ts` + `http/` 5；`test/` 2；`lib/` 24：`http/` 20 + `locks.*` 4）；manifest schema、既有 CLI 输出格式与 `.github/workflows/` 零变化。

**2026-09-27 · Added · 插件侧 Phase 1 纯增量核心：OpsIO 接缝与命令层收编（字节等价）、switch-version 七步编排与回滚、zip 安装五类防护、checkUpdates 六态提取与 listEntries 运行时合并；零既有行为变化 + 4 个新测试文件 49 条**

- **背景**：按插件侧设计方案 §13.1 的 Phase 1「纯增量核心」实施——收编只做字节等价改写（既有输出零变化），新能力全部以新模块 + 新接线落地，供 Phase 2 的 HTTP 路由（`/skills-nexus/*`）与 Phase 3 的 UI 直接复用。执行约定：单条功能分支 `feat/plugin-side`，每 Phase 验收后本地原子提交（不 push）。本提交即 Phase 1 全部产物。
- **变更（接缝）**：`src/ops-io.ts`（新，91 行）——`OpsIO` 接口（`emit` 一行 stdout 汇总、`progress` stderr 行/TTY 门控、`interactive` 反射 stdin TTY 于读取时刻、`confirm` 提问带默认值）+ `NeedsConfirm`（HTTP 侧逃生舱：非交互路径遇到需要确认的操作时抛出，携带 question/defaultValue）+ `cliIO` 实现（委托既有 process 流与 `prompt.confirm`，字节等价）。命令层收编：7 个命令全部加 `io: OpsIO = cliIO` 参数；`add` / `list` / `remove` / `toggle` / `update` / `doctor` / `completions` 的 stdout 汇总行全部由 `process.stdout.write` 收编为 `io.emit`；交互判定收编为 `io.confirm`（add×2、remove×2）与 `io.interactive`（remove 的 TTY 守卫）；错误通道保持 `process.stderr.write` 不动（OpsIO 无 error 通道，错误消息零变化）；唯一保留的直接 stdout 写是 `printHelp`（注释注明 Phase 2 按 §4.2 逐个收编，且 `test/completions.test.ts` 以其正则抓取 help 文本）。
- **变更（git 原语）**：`src/git.ts`——新增 `fetchRepo`（branch→tag→sha 三命名空间探测 fetch；显式 refspec 映射是唯一结果跨命令存活的形式，裸名 fetch 只写 FETCH_HEAD 不建本地 ref——浅克隆切换必须的「先 fetch」）；`resolveSwitchTarget`（DWIM 解析：按 fetch 落地的命名空间解析目标；未落地时按 `--type` hint 排序做离线回退，hint 从不持久化）；`checkoutBranch`（`checkout -B` 对齐 `origin/<ref>` 并 set-upstream，替换 remote.origin.fetch 映射）；`getCurrentBranch`（detached 或名称不安全时返回 undefined）。
- **变更（switch-version 编排）**：`src/switch-version.ts`（新，211 行）——§8.2 七步：① 记录旧链接集与旧 checkout ② fetch ③ 解析验证（缺失 ref → `RefNotFoundError`，此时零变更）④ 丢弃漂移（有警告 emit，与 update 逐字一致后 reset+clean）⑤ checkout ⑥ 重归一化 frontmatter ⑦ 重建链接（先删后建；disabled 条目不复活）后 `markUpdated(commit, ref)`；任一步失败回滚（checkout 回旧分支/旧 commit + 链接还原，best-effort 吞掉回滚自身错误）。错误类：`SkillNotFoundError` / `RefNotFoundError` / `ZipNotUpdatableError`。设计偏差（§6.3 原列 `git.ts`）在文件头注释说明：编排放独立模块，`git.ts` 保持纯原语、不依赖 manifest/链接/frontmatter。
- **变更（zip 安装）**：`src/zip.ts`（新，454 行）——手写最小 PKZip 解析器（runtime 零新依赖：只支持 stored/deflate，拒绝加密、zip64、非法 method）+ `installFromZip`；§9.1 防护全量：zip slip（越界/绝对路径/冒号段/NUL/空名 → 整包拒绝）、symlink 与 `.git` 条目跳过并警告、炸弹上限（200MB 上传 / 500MB 总量 / 100MB 单文件 / 5000 条目）、声明尺寸校验、staging→rename 原子落盘且失败清理；注册为 `source: 'zip'`（`ref`/`gitUrl`/`commit` 空，`url` = `zip:<文件名>`），安装时归一化 frontmatter（同 git 路径的同一份代码）。
- **变更（更新检查与列出）**：`src/health.ts`——`checkUpdates` 从 `doctor --updates` 提取（六态：`behind-remote`/`current`/`locked`/`absent`/`not-applicable`/`unresolved`；`names` 过滤；结果写入运行期缓存；pinned/absent/zip 不写），doctor 改为消费提取后的同一实现，输出格式零变化。`src/update-cache.ts`（新，37 行）——§5.2 进程内更新缓存（键=条目名，value=§7.2 的 update 对象，非持久、随进程消亡）。`src/manifest.ts`——`listEntries`（`enabled`/`links` 由官方技能根反推 + 合并缓存 `update` 或 `null`；只读不落盘）+ `markUpdated` 加 `ref` 参数。`src/link.ts`——`entryLinks`（反推某条目的全部链接）+ `isEntryEnabled` 委托。
- **变更（CLI 接线）**：`src/cli/commands/switch-version.ts`（新，148 行）——`switch-version <name> <ref> [--type <branch|tag|commit>]`：argv 解析（`--type` 两形态；未知 flag / 缺参 / 多余位置参 / 非法值 → stderr + exit 2）、未知技能在 banner 前预检查（stdout 零输出 + exit 1，对齐 update 行为）、核心错误类直写 stderr（无 `error:` 前缀）+ exit 1、成功输出 `✓ <before7> → <after7> (branch|pinned)` 与 symlinks 行；`src/cli/index.ts` 注册路由 + dispatch 显式传 `cliIO` + help 两段；4 个 completions 模板同步（子命令 + `--type`）。
- **不做**：`printHelp` / 错误通道 / 其余直接写的收编（Phase 2 §4.2 按点收集）；HTTP 路由与 `/list`/`check-updates` 接线（Phase 2）；客户端 UI（Phase 3）；不改 manifest schema；`doctor` 与既有命令输出格式零变化（等价重构）。
- **测试**：新增 4 文件 49 条——`test/ops-io.test.ts` **8 条**（真实流捕获验证字节等价 + TTY 双向强制 + `NeedsConfirm` 属性）；`test/zip.test.ts` **23 条**（手写 zip builder：正常安装/归一化/命名/多技能/跳过警告 + §9.1 全部拒绝矩阵 + 结构拒绝 + 注册守卫与 staging 清理）；`test/switch-version.test.ts` **14 条**（branch↔tag↔sha 端到端、缺失 ref 零变更、zip 拒绝、disabled 保持、多技能链接重建、dirty 丢弃警告、无远端时的 hint 排序离线回退、CLI 包装四态与流卫生）；`test/update-pipeline.test.ts` **4 条**（缓存单元 + 六态分类与缓存写入规则 + names 过滤 + listEntries 合并与不落盘断言）；`package.json` test 脚本 19 → 23 文件。全量 `npm test` **338 条 · 335 通过 · 0 失败 · 3 跳过**（跳过为既有 sparse 环境门控/补全用例，与本次无关）。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 退出码均 0；`npm run test:build`（覆盖 `test/` 的类型检查）退出码 0；CLI 冒烟（隔离 `DSH_HOME`）：usage 路径 exit 2、未知技能 exit 1 且 stdout 干净、成功路径输出契约定稿行。两处过程记录：收编初版把 `printHelp` 也改为 `io.emit`，`test/completions.test.ts` 的 help 抓取正则立即失败（该测试是正确的一致性守卫）——按 §4.2「Phase 2 逐个收编」回退，恢复原签名与写入方式；测试探针发现同名 branch+tag 并存时 `git symbolic-ref --short` 返回限定名 `heads/<x>`——实测该形式仍是合法 `git checkout` 参数（回滚路径无实际影响），故保留实现、测试改以完整 ref 断言。
- **如何辨识改动**：`git status --short` 除未跟踪探针残留 `.tmp-gitfetch-exp/` 外共 108 个条目——M 79（`src/` 17 + `package.json` 1 + 本 CHANGELOG 1 + `lib/` 产物 60）+ 新文件 29（`src/` 5：`ops-io.ts` / `switch-version.ts` / `zip.ts` / `update-cache.ts` / `cli/commands/switch-version.ts`；`lib/` 产物 20；`test/` 4）；manifest schema、既有 CLI 输出格式与 `.github/workflows/` 零变化。

**2026-09-27 · Added · 插件半边骨架就绪（Phase 0 三探针门禁全过）：服务端入口 `name` 导出 + 惰性 `webServer` 注入与 `/skills-nexus/ping` 路由；最小客户端半边（Settings「Skills Nexus」段）；新增客户端构建链 `build:client`（tsdown + tsc 两步）**

- **背景**：按插件侧设计方案 §13.1 的 Phase 0 门禁实施——「任何一条探针失败都会改变方案结构，在此之前不写任何产品代码」。三条探针全过：ping 探针证实 §7.4 webServer 契约；一行客户端探针证实 §10 客户端契约；junction 探针证实 §2.3 热加载结论在实际宿主成立（含附录 C-7 要求的「global 层禁用场景」核验）。本次提交即探针产物，同时是后续 Phase 的骨架；C-10（两步构建链）与 C-11（入口 name 导出）两条附录条目随之落地。
- **变更（服务端）**：`src/index.ts`——新增 `export const name = 'dsh-skills-nexus'`（与 `cordis.patch.yml` 的 insert id 一致，loader 诊断依赖）与 `export const inject: string[] = []`（顶层惰性注入的理由注释：保 CLI/tui/headless 兼容，仅 web 会话经 `ctx.inject(['webServer'], ...)` 惰性取路由能力）；`apply()` 经 `webCtx.effect(() => webCtx.webServer.register(spec), label)` 注册 `GET /skills-nexus/ping`——200 + `{ data: { name, status, now }, hotReload: 'done' }`，`no-store`，fiber 托管 disposer。
- **变更（客户端）**：`src/client/index.tsx`（新增）——最小半边：`name = 'dsh-skills-nexus-client'`、`inject = ['slots']`（cordis 服务名；与 `package.json` `dsh.client.inject` 的包名列表是两层，注释已写明）、`apply()` 经 `ctx.slots.inject('settings.section', ...)` 注册 id=`skills-nexus`/order=300/label=`Skills Nexus` 的设置段，正文为一行探针文本（Phase 3 换产品面板）。
- **变更（构建链）**：`tsdown.config.ts`（新增）——format cjs / platform browser，8 个平台模块外置（`deps.neverBundle`：react、react/jsx-runtime、react-dom、react-dom/client、@deepseek-ai/cordis、dsh-client-ui-slots、dsh-client-web-react、dsh-client-schema-form——浏览器 loader 的共享模块表，`require` 答不出的 specifier 必炸运行时），其余全内联（`deps.alwaysBundle`），`window.__ModuleLoader__.load({ id, factory })` 三段式 banner/footer/intro 包装。`tsconfig.client-types.json`（新增）——`emitDeclarationOnly` → `lib/client-types`（tsdown 不产类型，须独立 tsc，即 C-10 两步）。`package.json`——`dsh.client = { platform: 'web', inject: [4 个 @deepseek-ai 客户端包] }`、`exports['./client']`、`build:client` 脚本、devDeps：react / react-dom / @types/react / tsdown。
- **不做**：不实现任何产品功能（无 §7 路由表、无 zip/switch-version/任务通道——Phase 1/2 的事）；`build:client` 不并入 `build` 脚本（tsdown 0.22 要求 Node `^22.18 || >=24.11`，CI 仍测 Node 20——引擎与矩阵决策留待 Phase 5）；不写 `dsh.client.external` 等未实测字段。
- **测试**：无新增测试（门禁性质；既有 19 个测试文件零修改），全量 `npm test` **289 条 · 286 通过 · 0 失败 · 3 跳过**（与基线逐字一致）。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 与 `npm run build:client` 退出码均为 0。**探针 1**：`npx @deepseek-ai/dsh web --patch overlay.yml` 冷启动（dsh 0.1.5-rc.3，Windows），curl `/skills-nexus/ping` → 200 + 契约化 JSON；未知子路径 404；启动日志零 loader 报错。**探针 2**：宿主首页 `__DSH_BOOT__` 内含完整条目 `{"id":"dsh-skills-nexus","url":"/plugins/??dsh-skills-nexus/client.js&rev=…","inject":[4 包]}`；combo 路由返回 ModuleLoader 包装的 bundle 字节；Settings 出现「Skills Nexus」段并渲染探针文本；`--patch overlay.yml` 与 `dsh plugin add file:` 两条加载路径实测同构。过程记录一处契约修正：模块导出的 `inject` 初版误写 4 个包名，boot entry 永远 pending（`waiting for services`）致 web boot 整页报 Failed to load plugins，对照 dsh-research 真实 bundle（`inject = ["slots","locale"]`）改为服务名后通过。**探针 3**：`~/.dsh/skills/hello-skill` junction 建立后，运行中实例（未重启）新会话的「上下文注入 · skill-catalog」区即时出现该技能（description 原文可见）；删除 junction 后新会话即时消失；同时核验 C-7 层级——base 层 `skill-filesystem` 被 web-app patch 为 `disabled: true`，standard preset 在 scope 层挂载（默认 watch / followSymlinks），热加载在该层级下成立。另：tsdown 弃用字段 `external`/`noExternal` 已迁移为 `deps.neverBundle`/`deps.alwaysBundle`，迁移后重建产物 SHA-256 逐字节一致（测试测得等价）。
- **如何辨识改动**：`git status --short` 共 15 个文件——源码 2（`src/index.ts` 改、`src/client/index.tsx` 新）+ 构建配置 3（`tsdown.config.ts`、`tsconfig.client-types.json`、`package.json`）+ `package-lock.json` 1 + `lib/` 产物 8（`index.*` 四件套改 + `client.js`/`.map` + `client-types/client/index.d.ts`/`.d.ts.map` 新）+ 本 CHANGELOG；CLI 行为、manifest schema、`test/` 与 `.github/workflows/` 零变化。

**2026-09-27 · Fixed · 稀疏安装集成测试适配旧版 Git：12 条稀疏测试按本机能力门控、两版 README 注明稀疏流程需要 Git 2.35+**

- **背景**：外部评估在 Git 2.34.1（Ubuntu 22.04 LTS 默认版本，官方支持至 2027 年）上运行全量测试，报出 12 条失败（274 通过 / 2 跳过）。逐条对码定位：失败集合恰为 6 条（`test/git.test.ts` 的稀疏模式断言）+ 2 条（`test/add.test.ts` 的 `checkout: sparse` 与兄弟目录断言）+ 4 条（`test/update.test.ts` 的兄弟目录断言）——这些集成测试隐含了「本机 Git 支持 cone 模式稀疏检出」这一环境前提，但未把它表达出来。`sparse-checkout set --cone` 自 Git 2.35（2022-01）起提供；2.34 及更旧版本上 `cloneRepo` 的两步能力探测会正确判定缺能力、按设计降级为整仓检出（带可见警告），产品行为无误，失败仅由测试未按前提断言所致。CI（ubuntu-latest，Git 2.43+）与开发机（Git 2.50.1）不受影响，故此前始终全绿。
- **变更**：新增 `test/sparse-capability.ts`——测试侧能力探测：在一次性临时仓库内跑 `git sparse-checkout set -h`（判据与 `src/git.ts` 的 `sparseSetCapabilities` 同源，`LC_ALL=C`），导出 `SPARSE_SKIP`（无 `--cone` 时为 skip 原因字符串，否则 `false`）；并设交叉校验——帮助文本判无 `--cone` 而 `git --version` ≥ 2.35 时直接抛错，防止探测自身失效造成假绿（12 条用例被静默跳过仍显示全绿）。`test/git.test.ts` 6 条、`test/add.test.ts` 2 条、`test/update.test.ts` 4 条稀疏集成测试统一改为 `{ skip: SPARSE_SKIP }`；`test/git-sparse-probe.test.ts` 新增 1 条判据测试（2.35 形态帮助文本判真、2.34 形态判假）。`README.md` / `README_CN.md` 双语成对注明：稀疏流程需要 **Git 2.35+**，更旧的 Git 自动降级为整仓检出。
- **不做**：不改任何产品代码（`src/` 与 `lib/` 零变化）——探测与降级本就是显式设计；不把 12 条测试改写为「旧 Git 分支断言降级」——降级路径已由 `test/git-sparse-probe.test.ts` 对 mock Git 逐条覆盖（缺 `sparse-checkout`、缺 `--cone`、spawn 失败等），集成层按环境跳过即达意；新 Git 上的既有行为与断言零变化。不为旧版 Git（<2.35）设立 CI 作业——评审结论：2021 年发布的 Git 2.34 不再纳入 CI 覆盖，测试门控保留（旧环境上套件依旧全绿，仅失去持续验证）；若将来再现旧环境反馈再议。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 退出码均为 0；`npm run test:build`（覆盖 `test/` 的类型检查）退出码 0；`npm run build` 后 `git diff --stat -- lib/` 输出为空（构建产物零漂移）。全量 `npm test`（本机 Git 2.50.1）**289 条 · 286 通过 · 0 失败 · 3 跳过**（跳过为本机缺 bash/zsh/fish 的补全用例；基线 288 条，+1 为本条新增判据测试），12 条稀疏测试在本机真实执行、全部通过。负向对照（临时将 `SPARSE_SKIP` 强制为 skip 原因，模拟旧 Git）：**289 条 · 274 通过 · 0 失败 · 15 跳过**——跳过集合恰为 12 条稀疏（6+2+4，名称逐一核对）+ 3 条补全，随后复原并复跑恢复全绿。
- **如何辨识改动**：相对 v0.4.0，改动恰 8 个条目——测试 5（`test/sparse-capability.ts` 新增 + 4 个测试文件）+ 文档 3（`README.md`、`README_CN.md`、本 CHANGELOG）；`src/`、`lib/` 与 `.github/workflows/ci.yml` 零变化。

## [0.4.0] - 2026-09-27

**2026-09-27 · Security · 加固 repo spec / ref 与 `--subdir` 技能根的输入校验：拒绝 Git 选项注入（前导 `-`）、`transport::address` 辅助器语法（如 `ext::`）与控制字符；URL scheme 白名单（https/http/ssh/git/file）；远端默认分支名与符号链接技能根同样设防**

- **背景**：L3 深度安全审查报告 1 条 high 级发现（CWE-88 参数注入）：新增 `--subdir` 稀疏安装路径把 CLI 可控的仓库/subdir 值传入 git 子进程、缺少参数注入防护。逐条对码核实：全部 git 调用已是 `execFile` + argv 数组（无 shell）、`sparse-checkout set` 已带 `--` 分隔、`normalizeSubdir` 已拒绝绝对路径/盘符/控制字符/`..`——报告四条建议中三条本已满足；真实缺口三处：① `parseGitSpec` 兜底分支把任意字符串直通 git——`ext::sh -c …` 可经 git remote-ext 在本机执行命令，前导 `-` 会落入 git 选项位；② `getDefaultBranch` 把远端 symref 声明的分支名未经校验即作为 ref 使用（`refs/heads/-lead` 是合法 refname）；③ `--subdir` 技能根用 `stat` 判定，会跟随仓库中提交的符号链接。
- **变更**：`src/git.ts`——新增 `assertSafeUrl` / `assertSafeRef` 守卫：repo spec 归一化后统一校验（拒绝前导 `-`、控制字符、`^[a-z0-9][a-z0-9+.-]*::` 辅助器语法；`scheme://` URL 按白名单），裸本地路径与 `file://` 保持可用（离线验证流程依赖）；ref（`#ref` 与 `--ref`）拒绝前导 `-`、`::` 与控制字符（`git checkout` 的位置无法用 `--` 分隔——那里的 `--` 语义是路径恢复，故统一以「值校验」落实该建议）；`getDefaultBranch` 先校验远端分支名、不合格回退 `main`；新增 `isRealDirectory`（`lstat`，不跟随符号链接）。`src/cli/commands/add.ts`——`--subdir` 技能根检查改用 `isRealDirectory`（Git 树中祖先目录必为真实目录，末段校验即可封死逃逸）。
- **不做**：不向 `clone`/`fetch`/`checkout` 调用前插 `--`（`checkout -- <x>` 语义为路径恢复、不可用；经值校验后已不可能呈选项形）；不改 manifest 既有条目的 ref/url（写入时已经校验，手改 manifest 不在威胁模型内）。
- **测试**：`test/git.test.ts` 新增 5 条——parseGitSpec 拒绝矩阵（`-u`/`--upload-pack=evil`/`ext::sh -c id`/`git+ext::sh`/`foo::bar`/含换行的 https 均拒）；scheme 白名单拒绝（ftp/gopher）＋ `file://` 与裸本地路径保留断言；ref 拒绝矩阵（含 `--ref` 兜底值）；`getDefaultBranch` 远端 `-lead` 回退 `main` 而正常名 `stable` 直通；`isRealDirectory` 真目录/文件/符号链接/缺失四态（Windows junction / POSIX dir，跨平台可跑）。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 退出码均为 0；全量 `npm test` **288 条 · 285 通过 · 0 失败 · 3 跳过**（跳过为 completions 真实 shell 用例，与本次无关）；CLI 端到端实测：`add 'ext::sh -c id'` / `add 'ftp://host/repo'` / `add 'github:owner/repo#--upload-pack=evil'` 均在联网前拒绝并 exit 1；`git show HEAD:src/git.ts` 对新守卫零命中（旧代码不含这些检查，新用例只能在本次改动后通过）；`lib/` 随构建重建。
- **如何辨识改动**：除本 CHANGELOG 外，`git status --short` 仅 10 个条目——源码 2（`src/git.ts`、`src/cli/commands/add.ts`）+ 测试 1（`test/git.test.ts`）+ `lib/` 7 个构建产物；package.json、manifest schema、CLI 接口（flag 与输出格式）零变化。

**2026-09-27 · Fixed · 修正两版 README 本地测试的 overlay 路径指引：统一改为相对锚定写法 `'./lib/index.js'`，删除「盘符前必须加 `/`」说明**

- **背景**：两版 README 此前指引 Windows 把 `name` 写成 `'/C:/...'`——该写法在本文件 2026-08-22 条目记录的语境下正确（当时裸 `C:/...` 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，故在盘符前加 `/`）；但当前 dsh（本机 0.1.5-rc.3，2026-09-23 更新）的 `dsh-app-boot` 改按路径语义解析 insert 条目（`anchorInsertedPluginNames`：`pathToFileURL(path.resolve(base, name))`），`'/C:/...'` 被解析成 `C:\C:\...`，`dsh web --patch overlay.yml` 冷启动必报 `Cannot find module 'C:\C:\...'`（插件树加载失败）。属文档随宿主语义演进而过期，非用户操作问题。
- **变更**：`README.md` / `README_CN.md` 双语成对——本地测试第二步的 overlay 模板与一键生成命令统一为与平台无关的 `'./lib/index.js'`（相对路径以 overlay.yml 所在目录为锚；Windows / macOS / Linux 同一写法，不再需要 `pwd` / `pwd -W`）；删除 Windows 特判段与「盘符前必须加 `/`」说明；`file:///…` 保留为绝对路径备选；两版文末生成说明同步。
- **验证方式**：本机实测（Windows、dsh 0.1.5-rc.3）：`name: './lib/index.js'` 下 `npx @deepseek-ai/dsh web --patch overlay.yml` 冷启动成功（`dsh web: http://127.0.0.1:3080/`，无 loader 报错）；对照复现 `'/C:/...'` 报 `Cannot find module 'C:\C:\...'`。纯文档改动，不涉及四步门禁。
- **如何辨识改动**：本条改动 `README.md` / `README_CN.md` 两版（`CHANGELOG.md` 为记录本身）；两版 README 第二步的平台分栏（Windows 与 macOS / Linux 两段）合并为一段，`grep -n "pwd -W" README.md README_CN.md` 零命中。

**2026-09-27 · Docs · 修正 `docs/verify-collection-support` 两版 [i] 步骤的根文件清单：示例仓库根目录实为 3 个文件（补 `community-leaderboard.md`）**

- **背景**：[i] 段的代码块注释与汇总表此前按「两个根文件」（`CONTRIBUTING.md`、`README.zh-CN.md`）描述 `ls` 预期输出；示例仓库脚本实际创建 3 个根文件（另有 `community-leaderboard.md`，服务于「文档型平铺 md 不算 skill」用例），注释与汇总未随之同步。
- **变更**：`docs/verify-collection-support.md` 与 `.zh-CN.md` 双语成对——[i] 段代码注释（两处平台段）与汇总表 `[i]` 行由「两个根文件」修正为 3 个（补 `community-leaderboard.md`）。
- **验证方式**：纯文档改动；依据 [i] 段端到端实跑输出修正（`ls "$SPARSE_CLONE"` 实测为 3 个根文件 + `skills`，与示例仓库脚本创建的根文件一致）。

**2026-09-26 · Changed · `--subdir` 安装改为独立稀疏检出（partial clone + cone sparse-checkout，含能力探测与降级）；显式 `--name` 与默认条目名相同时打印省略提示**

- **背景**：`--subdir` 挑装此前是「整仓文件的浅克隆」——`--depth 1` 只压缩历史深度，同仓库装多个子目录仍会重复下载整仓内容。本次落地已批准方案的 A+C：A 把新装路径改为 partial clone（`--filter=blob:none`）加 cone 模式 sparse-checkout，只物化目标子目录（及 cone 规则保留的仓库根/祖先目录直属文件）；C 在显式 `--name` 冗余时给一次提示。两者都不改变条目语义、manifest schema 与命令接口。
- **变更（A）**：`src/git.ts` 的 `cloneRepo` 增加可选 `{ subdir }` 第三参并返回 `{ mode: 'full'|'sparse', warnings }`；有 subdir 时按 `clone --depth 1 --filter=blob:none --no-checkout` → `sparse-checkout set --cone -- <subdir>`（一律在首次显式 checkout 前建立规则）→ `checkout <ref>` 执行，SHA 回退链同样走 filtered、no-checkout 克隆；能力探测分两步——任意调用目录的 `git sparse-checkout -h` 判命令存在性、克隆内 `set -h` 判 `--cone`/`--skip-checks`，帮助命令正常的非零退出码不算能力缺失；明确缺能力时复用本次未检出的克隆补成整仓浅检出并给可见警告 `sparse checkout is unavailable in this Git — the whole repository was materialized`（不重复下载），远端忽略 filter 时继续稀疏检出并警告 `the remote ignored the blob filter — this clone may have downloaded the whole repository`（对象库可能已含全仓），网络/认证/ref/磁盘失败沿用原失败语义、不转整仓回退；`subdir` 联网前做仓库相对路径校验（较原有『前导斜杠、`..`』检查扩张：绝对路径、盘符/UNC、控制字符一并拒绝）。`src/cli/commands/add.ts` 接线并输出 `checkout: sparse|full` 行与 `⚠` 警告；`src/cli/index.ts` 帮助文本与 `src/paths.ts` 注释同步；无 `--subdir` 的安装仍走整仓浅克隆（行为不变）；`update`、链接、预览与 manifest 登记流程未动。
- **变更（C）**：`--subdir` 安装成功、且显式 `--name` 经 `sanitizeName` 归一后等于默认条目名（subdir 末段）时，追加一次 `提示：--name 与默认条目名 "x" 相同，可省略。`；未传/名称不同/失败/中止均为 0 次。只加提示，不改命名规则与机器接口（`list --names`、`doctor --json` 均未动）。
- **不做**：B 共享克隆/引用计数/对象缓存；旧整仓克隆不自动迁移（升级与 `update` 都不追溯回收——要受益需卸载重装；文档给出手动退出稀疏的单向操作 `git -C <克隆目录> sparse-checkout disable`，且 `update` 不会重新强制稀疏）；不自动识别跨目录依赖；不新增 CLI flag、不改补全机制。对外表述限定为「稀疏检出、通常减少下载」，不承诺严格只下载一个目录或硬性流量上限。
- **测试**：`test/git.test.ts` 扩至 **45 条**（`normalizeSubdir` 路径规则 5 条 + 稀疏集成 8 条：filter 生效时对象库不含无关 blob、filter 被忽略警告、tag/SHA/hex 分支名、非仓库 cwd 探测、失败清理、拒绝已存在路径）；`test/add.test.ts` 扩至 **23 条**（`checkout: sparse` 输出、junction 实际指向 subdir、双 subdir 独立、失败/中止零提示、C 命名提示矩阵）；`test/update.test.ts` 扩至 **9 条**（稀疏快进、tag 漂移恢复、dirty 清理后稀疏保持、同源独立性）；新建 `test/git-sparse-probe.test.ts`（**7 条**）：经 `createRequire` 注入 `execFile` mock 覆盖能力探测分支——缺 `sparse-checkout`、缺 `--cone`、帮助输出异常、spawn 错误、SHA 回退链参数、分支重试与失败清理。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`，删掉一处无效 `eslint-disable` 后零告警）/ `npm test` / `npm run build` 退出码均为 0；全量 `npm test` **283 条 · 280 通过 · 0 失败 · 3 跳过**（跳过为 completions 的 bash/zsh/fish 真实 shell 用例——本次在 PowerShell 环境运行、三者不在 PATH，CI 中真实执行，与本次改动无关；基线 246 条）。真实产物端到端实测（Git 2.50.1，隔离 `DSH_HOME` + 本地 `file://` 上游）：`add --subdir skills/beta` 输出 `checkout: sparse — only this subdir is materialized` 与 `⚠ the remote ignored the blob filter…`（`file://` 远端默认 `uploadpack.allowFilter=false`，属预期）；克隆工作树只有 `skills/beta` 和 cone 保留的根文件（`README.zh-CN.md`/`CONTRIBUTING.md`），`git -C <clone> sparse-checkout list` → `skills/beta`；`sparse-checkout disable` 后 `alpha` 落盘、再 `list` 报 `not sparse`（exit 128），`remove beta` 正常删净。`lib/` 随源码重建（CI 在 ubuntu 用 `git diff --exit-code -- lib/` 校验同步）。
- **如何辨识改动**：`git status --short` 仅 31 个条目——源码 4（`src/git.ts`、`src/cli/commands/add.ts`、`src/cli/index.ts`、`src/paths.ts`）+ 测试 4（`test/git.test.ts`、`test/add.test.ts`、`test/update.test.ts` 改，`test/git-sparse-probe.test.ts` 新）+ `package.json` 1 + 文档 8（本 CHANGELOG、`README.md` 两版、`docs/subdir-design.md`、`docs/verify-collection-support.md` 两版、`docs/ARCHITECTURE.md` 两版）+ `lib/` 14 个构建产物随 `npm run build` 重建；无其他文件被触及。

**2026-09-26 · Docs · README 安装章节适配 npm 12 的 Git 依赖策略：`EALLOWGIT` 排障与一次性 `--allow-git=all` 说明；补注册 DSH 插件的可选步骤；「待发布」占位改为 registry 安装命令**

- **背景**：npm 12 起 `allow-git` 默认从允许改为 `none`，而 `github:owner/repo` 属于 Git 依赖——原安装命令 `npm install -g github:xiaxi626/dsh-skills-nexus` 在 npm 12 下会在下载前被策略拦截并报 `EALLOWGIT`（`Fetching packages of type "git" have been disabled`）；README 安装章节此前未覆盖该策略。另有两处待更新：`lib/` 说明后的「Once the package is published to npm…」占位已过期（包已发布 registry、当前 `0.3.0`），且 `dsh plugin add` 与 CLI 全局安装的关系（前者非后者前置条件）在安装段未展开。本次仅为文档修复，不改任何代码或包配置。
- **变更**：`README.md` / `README_CN.md` 双语成对——安装章节拆为「Optional: register as a DSH plugin / 可选：注册为 DSH 插件」（`dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"`：只由 pnpm 把包装进 profile 的 `node_modules`，不提供全局 CLI、也非 CLI 安装的前置条件）与「Install the CLI globally / 全局安装 CLI」两节；CLI 安装按 npm 版本分两条命令——npm 12 在确认信任仓库及其依赖后显式放行 Git 依赖（`npm install -g --allow-git=all github:xiaxi626/dsh-skills-nexus`），较旧 npm 沿用原命令；新增「Troubleshooting `EALLOWGIT` / 遇到 `EALLOWGIT` 怎么办？」小节（错误样例、根因、`npm --version` 与 `npm config get allow-git` 自查、明确「不代表 npm 检测到恶意代码、不表示与 npm 12 不兼容、无需重装插件或降级 npm」，并以引用块警示 `--allow-git=all` 仅对本次调用生效、会放行含传递依赖在内的全部 Git 依赖、不认证其安全、避免全局永久设置、`dsh plugin add` 走 pnpm 配置相互独立）；`lib/` 说明后补 registry 路由 `npm install -g dsh-skills-nexus`（registry 包非 Git 依赖、无需 `--allow-git`，发布版可能与 GitHub 最新代码不同）；插件层提示块精简；卸载/切换远端提示从「再 `npm install -g github:<owner>/<repo>`」改为指向 [Install nexus](#install-nexus) 的版本与策略说明（npm 12 需显式 `--allow-git=all`）。
- **验证方式**：纯文档改动——`git show --stat 903eb22` 仅 `README.md` 与 `README_CN.md` 两文件（共 +126/−20），`src/`、`lib/`、`test/`、`package.json` 零变化，不涉及四步门禁；两版安装章节逐节对照（小节标题、命令、错误样例、`--allow-git=all` 警示、registry 路由一一对应，唯语言不同）。

**2026-09-22 · Docs · CLI `--help` 的「Accepted repo forms」补齐 SSH（`git@` / `ssh://`）与 `git+https://` 写法，并澄清 `/tree` 子路径被忽略（装子目录须显式 `--subdir`）**

- **背景**：`parseGitSpec`（`src/git.ts`）早已支持 scp-like（`git@host:owner/repo.git`）、`ssh://`、`git+https://`，并把 `https://…/tree/<ref>/<path>` 归约到仓库根（子路径与其内的 ref 均忽略、只认 `#ref`）；`test/git.test.ts` 以「scp-like git@ and ssh:// URLs pass through untouched」「git+https: scheme is stripped and normalized」「/tree/<ref>/... subpath is reduced to the repo root」三条用例钉住，README.md / README_CN.md 也都列了这些形式。唯独 CLI `--help`（`src/cli/index.ts` 的 `printHelp()`）漏列 SSH 与 `git+https://`；且 `/tree` 子路径的行为易被误解为「按子目录安装」——实际它被忽略、克隆的是仓库根，装子目录须显式 `--subdir`。本次仅补文档性输出并澄清该误解，不改任何解析行为。
- **变更**：`src/cli/index.ts` 的 `printHelp()` 在「Accepted repo forms」段补 `git+https://…`、`git@…  (SSH)`、`ssh://…  (SSH)` 三行，并在列表后新增一段说明：`https` URL 的 `/tree/<ref>/<path>` 后缀被接受但忽略、克隆的是仓库根，装集合仓库的单个子目录须用 `--subdir <path>`（`/tree` 路径不会替你选子目录）；`lib/cli/index.js` 与 `.js.map` 随源码重建（`printHelp` 为模块内私有函数、签名未变，故 `lib/cli/index.d.ts` 不漂移）。
- **不做**：不改 `parseGitSpec` 的解析行为（这些形式与 `/tree` 归约早已实现并有测试，无需改码）；不改 `--subdir` 逻辑；不引入「自动从 `/tree` 路径推导 `--subdir`」的新行为（那是功能变更、须另行立项，且会与「`/tree` 仅用于浏览定位、不承诺安装语义」的现有约定冲突）。
- **如何辨识改动**：`git status --short` 仅 3 个源码/产物文件变化——`src/cli/index.ts`、`lib/cli/index.js`、`lib/cli/index.js.map`（`lib/cli/index.d.ts` 不变；`CHANGELOG.md` 为本条）；`node lib/cli/index.js --help` 的「Accepted repo forms」段多出 `git+https://…` 与两行 SSH，段末多出 `/tree` 子路径忽略说明三行。
- **验证方式**：四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`）/ `npm test` / `npm run build` 退出码均为 0；全量 `npm test` **246 条 · 0 失败**（243 通过 / 3 跳过，跳过项为本机缺 zsh/fish/bash 的补全用例，数量随本机 shell 可用性浮动、与本次改动无关）；本次仅改 `printHelp()` 字符串、无逻辑变更、不新增用例，相关解析行为早由 `test/git.test.ts` 覆盖；`node lib/cli/index.js --help` 目视新增行与说明段、列对齐无误。

**2026-09-22 · Docs · 新增「在 nexus 之上构建 / 基座」双语文档 `docs/build-on-nexus.md` / `.zh-CN.md`；README 双语补「给工具开发者」小节与文档索引**

- **背景**：本次是主动为未来预留——尚无开发者提出把本项目当基座，但 nexus 客观上已具备被当作「往 DSH 装 GitHub SKILL.md 仓库」基座的条件（可供 GUI / 同步守护进程 / CI / 上层安装器复用）。趁早把对外可依赖的接口面收拢成一处、并划清边界，好过日后有人来集成时才补：此前可依赖的只读接口散落在 `doctor` 与 `list --names` 各自的验证文档里、无一处统一交代；更缺一份「没有承诺什么」的说明，容易诱导未来的外部工具去 `import` 包内部或直接解析 `manifest.json`（内部 schema 会演进，直读必被静默打断——`list --names` 存在的初衷正是此解耦，同理 git 补全调 `for-each-ref` 而非读 `.git/refs/`）。
- **决策（只承诺已被测试钉住的只读面）**：文档只承诺两个既有且有测试锚的只读接口——`doctor --json` 的 `version: 1` 契约与 `list --names` 名字流；不借「写文档」顺带承诺任何新机器契约。写侧 JSON（`list --json`、`add`/`remove` 结构化输出）属契约设计级别的重大决策，须单独立项评审，否则会把未经测试的表面积变成对外义务。放弃的替代：随文档规划写侧接口、把更多 `exports` 子路径当公开 API 治理（二者非错，仅需另行立项）；否决 GitHub wiki（项目文档文化为 in-repo 双语成对、随 PR 原子提交、被测试引用，wiki 会造成双源分裂）。
- **变更**：新增 `docs/build-on-nexus.md` 与 `docs/build-on-nexus.zh-CN.md`——五段结构：其一「为什么在 nexus 之上构建」（列出 nexus 已解决的跨平台琐碎项：spec 解析 / 带重试克隆 / ref 固定与锁 / frontmatter 归一化 / 集合 `--subdir` / junction 软链 / 官方 provider 免维护发现）；其二两个可依赖只读接口的完整契约（`list --names` 的逐行/空串/退出码/内联值护栏；`doctor --json` 的 `version: 1` 顶层形状、检查项 id 顺序 `manifest`/`roots`/`symlinks`/`orphan-repo`/`orphan-link`/`git-sanity`/`updates`、`status` 四态 `ok`/`warn`/`error`/`update-available`、issue `code` 全清单、退出码，并回指 `verify-doctor` 取每项含义）；其三「没有的接口」清单（写侧无机器输出、`add` 静默忽略未知 flag、暂无 `list --json`、无 Cordis service/provider/hook、包内部含 `./resolve` 均非公开 API）；其四集成范式（shell out、补全脚本为参考消费者、symlink 可见性 vs Policy 状态的生态边界、自动化零不可信代码执行）；其五稳定性分级与维护规则（`version` 递增即破坏性变更）。README.md / README_CN.md 各新增「For tool builders / 给工具开发者」小节并在文档索引各补一条对应语言链接。
- **不做**：不新增或改动任何源码与测试（纯文档）；不承诺写侧机器接口；不改 `doctor --json` / `list --names` 的既有行为。
- **如何辨识改动**：`git status` 仅显示 5 个文件变化——2 个新文件（`docs/build-on-nexus.md` / `.zh-CN.md`）+ 3 个改动（`README.md`、`README_CN.md`、`CHANGELOG.md`），`src/` 与 `lib/` 零变化。
- **验证方式（文档即事实，逐字回码核对）**：文档所述契约均取自当前源码而非追记——检查项 id 顺序与 `status` 四态取自 `src/cli/commands/doctor.ts`（`finalize`/`runChecks`/`checkUpdates` 返回值）；issue `code` 全清单取自同文件各 `code: '…'` 字面；`--json` 输出为 `JSON.stringify(report, null, 2)` + 换行（2 空格缩进、末尾换行）；`list --names` 逐行/空串/退出码 0·1·2/内联值护栏取自 `src/cli/commands/list.ts` 与 `src/cli/args.ts` 的 `parseListArgs`；`add` 静默忽略未知 flag 取自 `parseAddArgs`（未知 `--flag` 不进任何分支、不报错）；`exports` 仅 `.`/`./resolve`/`./package.json` 取自 `package.json`；`apply()` no-op 取自 `src/index.ts`。双语两份逐节对照小节标题与契约值一致，唯正文语言不同。README 两份的小节与索引链接对称新增。

**2026-09-20 · Docs · 新增「命令自动补全」双语验证指南 `docs/verify-completions.md` / `.zh-CN.md`；README 与 CONTRIBUTING 双语补索引（命令自动补全 P3）**

- **背景**：P1 / P2 交付四份补全模板后，「照抄即可复现」的端到端验证面还散落在开发期的临时探针里；其中 PowerShell 的两条引擎行为（裸 `-`/`--` 不触发参数补全器、补全器空集时回落文件名补全）与 bash 的 `COMPREPLY` 语义都只能靠实测与源码证据定性，zsh / fish 在本机（无 zsh / fish / WSL / 容器）无法执行、已移交 CI。故仿 `docs/verify-doctor.md` 范式补一份双语验证指南，并同步双语文档索引。
- **变更**：新增 `docs/verify-completions.md` 与 `docs/verify-completions.zh-CN.md`——置顶 Shell 警告（每个块在标题所写的 shell 里跑）、测试套件段（三条执行测试的 skip 语义与 CI 真跑范围）、分 shell 端到端块（bash / PowerShell / zsh / fish，各自自包含：两个本地 `file://` 上游 + 隔离 `DSH_HOME` + PATH 上的 stub CLI + 逐场景候选断言）、引擎行为三条、实践中遇到的坑九条、覆盖边界六条；README.md / README_CN.md 用法段各补 `completions` 一行、新增「Shell completion / Shell 补全」小节（四 shell 的装载与卸载命令 + 命令名由 PATH 机制负责的说明）、文档索引各补链接；CONTRIBUTING.md / CONTRIBUTING.zh-CN.md 的「想端到端验证？」索引各补一条。
- **关键设计（bash 的 `COMPREPLY` 语义，源码级裁定）**：以 Debian `bash 5.2.15-2` 的 `pcomplete.c` 为证——`gen_shell_function_matches` 每轮读取 `COMPREPLY` 后执行 `unbind_variable_noref("COMPREPLY")`（附 `/* XXX - should we unbind COMPREPLY here? */` 注释），调用前的 `bind_compfunc_variables` 不创建也不清空该变量 → 引擎保证上一轮候选不可能漏进下一轮。直接调用补全函数（测试 / 探针 / 文档驱动）绕过引擎，需自带 `COMPREPLY=()` 复位以复刻引擎的干净状态——文档驱动含此复位与解释注释；**模板本身无需防御性复位**（探针里曾观察到的「次级候选污染」由此定性为绕过引擎所致，非模板缺陷）。
- **不做**：不覆盖候选菜单的交互外观（布局 / 匹配风格 / 高亮——候选集正确后属 shell 补全系统自身的职责）；不在指南中手工构造 zsh / fish（Windows 无此二者，交 CI 真跑）；不复述模板实现细节（在各自源码注释与 P1 / P2 条目）。
- **验证方式（文档即实测）**：两版指南的端到端代码块均为实测脚本逐字抽取（不手抄）——bash 块回放（Git Bash 5.2.37）10 场景、PowerShell 块回放（PS 5.1.26100.9444）9 场景，输出与文档「期望输出」逐字一致（含 PS `remove-second` 的回落说明——该行为经 `git` 注册同一空答案补全器做对照实验，确认为引擎策略而非模板缺陷）；zsh / fish 块的期望输出即测试套件将在 CI 执行的断言。双语块校验（抽取全部 fenced 块、剥离行内注释与注释行后逐行比对、大小写敏感）：**10 / 10 块、命令逐字一致**，唯一保留差异为 PowerShell 期望输出块中一条说明性占位文本的翻译（该行本就不是输出——真实的回落文件名取决于运行目录）。另记录两处 PS 5.1 构建差异（`Set-Content -NoNewline` 不存在 → 改用 `[System.IO.File]::WriteAllText`；`$TROOT` 反斜杠需归一为 `/` 才能构成 `file:///` URL）。README 卸载说明的证据：bash 路径以「装载 → 卸载 → 再装载」循环实测（`complete -r` 后注册消失、重新 eval 恢复）；fish 的 `complete -c <cmd> -e` 取自官方文档、zsh 的 `compdef -d` 取自官方源码（compinit 注释与示例，本机无 zsh / fish 可执行验证）；PowerShell 的 `-ScriptBlock $null` 注销经本机 PS 5.1 实测（stub 注册后生效、空块重注册后消失）。

**2026-09-20 · Added · 新增 `completions --shell zsh` 与 `--shell fish`：补全脚本四件套齐全（命令自动补全 P2）**

- **背景**：P1 交付 bash + PowerShell 后，zsh/fish 按计划留到 P2（每个 shell 的补全 DSL 互不兼容，各是一份独立实现、各有一份验证面）。P2 开始即确认了执行验证的硬约束：开发机（Windows）无 zsh、无 fish、无 WSL 发行版、无容器运行时，两个模板**无法在本机执行**；决策为**全量实现 zsh + fish、执行验证交 CI**——ubuntu 作业安装 zsh + fish（macOS runner 自带 zsh 真跑、Windows 仅有 Git Bash 的 bash），并同步修改 `.github/workflows/ci.yml`，否则两个新模板会因缺 shell 被跳过、坏了也绿着发布。
- **变更**：新增 `src/cli/commands/completions/zsh.ts` 与 `fish.ts`（延续纯字符串数组 `.join('\n') + '\n'` 构建——模板本身满是 `${...}`/`$(...)`，写成模板字面量会被 TS 先吃掉；纯 ASCII）；`completions.ts` 的 `SUPPORTED_SHELLS` 扩为 `['bash', 'zsh', 'fish', 'powershell']`（顺序即模板广告顺序）、`TEMPLATES` 注册两项；`bash.ts` / `powershell.ts` 的 `--shell` 候选值清单同步为四个（不同步则用户在 bash/PS 里补出三缺一的旧清单）；`src/cli/index.ts` 头注释 / usage / `completions options` 三处 `<bash|zsh|fish|powershell>`。
- **关键设计（zsh：宁可手动词法，不驱动 `_arguments`）**：另三个模板实现的同一条不变量——「忽略 `-` 开头的词后计数位置参数」——在 `_arguments` 里没有直接拼法；而 `_arguments` 每引入一层协作协议（`args` 状态里 `words` 会被移位、spec 字符串语法）就多一个「静默给不出候选」的失败模式，初稿 zsh 模板正是这样死的（`update|pull`/`remove|rm` 会先命中旧分支、动态补全分支永不可达）。改用手动词法，只用 `#compdef` 函数最基础的契约：`words[1]`=命令、`words[2]`=子命令、`words[CURRENT]`=当前词，计数逻辑与 bash 版逐词对应。另三处细节：`emulate -L zsh` 隔离用户的 `noglob`/`err_exit`/`ksh_arrays` 等选项改变脚本语义；计数递增用 `nargs=$(( nargs + 1 ))` 赋值而非 `(( i++ ))`（后者在结果为 0 时退出状态非零，配用户开启的 `err_exit` 会中断补全）；空 `skills` 数组有 `(( ${#skills} ))` 守卫才 `compadd`。候选不做预过滤——`compadd` 交给 zsh 按用户自己的 matcher 过滤；是否回落文件名由用户的 completer 链决定，不归脚本管。
- **关键设计（fish：声明式规则；`complete -C` 让端到端可测）**：每个 option 一行 `complete -c dsh-skills-nexus ...`，子命令规则用 fish 自带 helper `__fish_use_subcommand`、flag 规则用 `__fish_seen_subcommand_from <cmd>` 作用域。名字规则的计数条件与另三个模板语义等价：`commandline -opc` 取光标前的词，`string match -r -v -- ^- "$t"` 滤掉 flag，非 flag 词恰为 2 个（命令名 + 子命令）才给候选——`remove --yes <TAB>` 仍补名字。两个防御性细节：`"$t"` / `"$t[2]"` 加引号，防用户输入的通配符被 glob；保证 `string match` 至少收到一个 STRING 参数——无参数版本会**读 stdin 阻塞 Tab**。fish 的 `complete -C '<cmdline>'`（「此命令行会给什么候选」的官方入口）不需要 TTY，使端到端测试在 CI 里直接真跑 fish 自身的过滤逻辑。
- **不做**：不给 `add` 的位置参数（仓库 spec）补全（不存在可枚举数据源）；不给 `--shell=` 内联形态做专门的值补全（四个模板一致，只覆盖 `--shell <TAB>` 空格形态）；macOS/Windows 的 CI 不装 fish（ubuntu 已真跑两个模板，macOS 自带 zsh 已覆盖 zsh；在 macOS 上装 fish 要走 brew、Windows 无合理路径，收益不成比例）；不引任何第三方依赖；不读 `manifest.json`。
- **测试**：`test/completions.test.ts` 从 20 条扩到 **24 条**——漂移护栏全部扩到四模板（子命令清单仍从 `src/cli/index.ts` 的 `case` 标签抽取，新增 zsh 的 `cmds=(...)`、fish 的 `__fish_use_subcommand -a` 两个抽取器；flag 清单改用 TEMPLATES 表 + 每 shell 的 needle——fish 的 needle 是 `-l <name>` 形态）；位置参数计数的文本锚扩到四模板（zsh `nargs=$(( nargs + 1 ))`、fish `string match -r -v -- ^-`、PowerShell 原有）；新增 3 条：`every supported shell is accepted`（并修掉两条旧断言——`--shell zsh` 在 P1 时是「不支持的 shell」用例样本，现在合法）、`every template offers exactly the shells --shell accepts`（从四模板各抽 `--shell` 候选清单、归一化后与 `SUPPORTED_SHELLS` 排序比对，清单漂移无处可藏）、`the four templates are four different scripts`。两条新可执行用例：**zsh** 用 `zsh -f -c` 装载模板、stub `compdef` 与 `compadd`（recorder 记录原始参数）后断言 9 个场景传给 `compadd` 的参数列表（诚实披露：zsh 自身的匹配/过滤语义与 compinit 装载不在断言范围）；**fish** 用 `fish -c "source <tpl>; complete -C '<cmdline>'"` 做真端到端（9 个精确 + 2 个宽容 + 2 个负向场景，stub CLI 提供 `alpha`/`beta`）。两者在缺 shell 的机器上 skip（本机 skip、CI 真跑）。
- **验证方式**：聚焦 `node --import tsx --test test/completions.test.ts`：**24 条 · 22 通过 · 2 跳过**（本机无 zsh/fish；bash 可执行用例真跑通过）。四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`）/ `npm test` / `npm run build` 退出码均 0；全量 `npm test` **244 通过 / 2 跳过（共 246 条）**（基线 242，+4）；`lib/` 随源码重建（新增 `cli/commands/completions/zsh.*` 与 `fish.*` 共 8 个文件）。真实产物端到端（不经 tsx，直接跑 `node lib/cli/index.js`）：四个 shell 的输出与模板逐字节相等（bash 1513 / zsh 1929 / fish 1646 / powershell 2220 字节），`completions --shell tcsh` exit 2 且 stdout 保持为空。`actionlint .github/workflows/ci.yml` 0 errors。辨识指纹：用例数 242 → 246；负向对照——删掉 zsh `cmds` 里的 `help` 与 fish `--shell` 候选里的 `zsh`，聚焦套件 **24 条 · 20 通过 · 2 失败 · 2 跳过**（两条新护栏以各自 message 转红），复原后 22 通过 / 0 失败。另有一处锚力实证：`never to manifest.json` 锚首次运行即转红——zsh/fish 输出脚本的注释里写了该词，注释改措辞（`state file`）后转绿。**诚实披露**：zsh 的真实补全行为（compadd 过滤、compinit/`compdef` 装载、`words`/`CURRENT` 契约）与 fish 的首次真实执行结果在本机无法取得（无 zsh、无 fish、无 WSL 发行版、无容器运行时），已移交 CI 首跑验证——ubuntu 作业（安装 zsh + fish）与 macOS 作业（自带 zsh）会真跑两个模板；若首跑暴露模板缺陷，修复将随后提交并在此追加记录。
- **CI 首跑与修复（2026-09-21）**：推送（`0865e8f`）后首跑（run 35570410905）把这份欠账结清——Windows 三个作业全绿，ubuntu / macOS 六个作业均在 `Unit tests` 转红：zsh 用例（ubuntu / macOS 两侧）与 fish 用例（仅 ubuntu——macOS 按设计不装 fish）这两条一直被本机 skip 的真跑用例第一次进了真实 shell。① zsh 用例是**期望表笔误**（`test/completions.test.ts`）：`shell-values` 一行漏了驱动契约里的 `--` 前缀（recorder 原样记录 `compadd` 的原始参数——带字面候选的场景均以 `--` 开头，唯此一行漏写；模板本身行为正确），补上即对齐。② fish 用例是**模板缺陷**（`src/cli/commands/completions/fish.ts`）：名字规则从未触发（`update <TAB>` 空候选）——根因是条件里的 `string match -r -v -- ^- "$t"`：fish 双引号内的列表变量恒展开为**单个参数**（官方语言文档：Inside double quotes, variables will always expand to exactly one argument; the elements will be joined with spaces），`count` 恒为 1、`-eq 2` 恒假。修复取「逐元素」形态而非拆引号：`for i in (seq (count $t))` 内逐词 `if not string match -qr -- ^- "$t[$i]"; set -a p "$t[$i]"` 再 `count` 判 2——修掉 join 的同时保住原设计的另一半动机（`string match` 恒有 STRING；空参形态会读 stdin 挂起补全）。**附带修正 P2 条目的一条设计表述**：「`"$t"` 加引号，防用户输入的通配符被 glob」不成立——官方「Bash 用户对照」文档明确 *Globbing doesn't happen on expanded variables*（且无开关可控制），引号的真实作用是保证参数恒为一个（含空元素），当时未察觉的 join 副作用才是本轮缺陷。同步更新条件注释（去掉 glob 理由、补入 join 与 stdin 两条真实理由）、模块头注释与文本锚（新锚 `/string match -qr -- \^- "\$t\[\$i\]"/` 钉住「逐元素 + 引号」——退回 join 形态或去掉引号都会转红）。本机门禁四步全绿（typecheck / lint / 全量 **246 条 · 244 通过 · 2 跳过** / build；zsh / fish 用例仍按设计 skip——本机无 shell），`lib/` 随源码重建；两个模板的真跑复验随下一次推送的 CI 完成。

**2026-09-20 · Added · 新增 `completions --shell <bash|powershell>`：输出可直接 eval 的 shell 补全脚本（命令自动补全 P1）**

- **背景**：P0 已铺好动态数据源 `list --names`，本步落地补全入口与模板。计划的初稿是 bash/zsh/fish 三件套，但每个 shell 的补全 DSL 互不兼容（bash `complete -F`+`COMPREPLY`、zsh `#compdef`+`_arguments`、fish `complete -c`、PowerShell `Register-ArgumentCompleter`），一次铺满四个等于四份独立实现、四倍验证面，故 v1 只做 bash（Linux/macOS 最大用户群）与 PowerShell（Windows 用户群），zsh/fish 留 P2——一个命令一次只吐一个 shell 的脚本，用户按需 eval。
- **变更**：新增 `src/cli/commands/completions.ts`（`SUPPORTED_SHELLS`、`parseCompletionsArgs`、`completions()`：`--shell` 必填、`--shell bash` 与 `--shell=bash` 两种写法等价，未知参数与不支持的 shell 一律用法错误 exit 2 **且 stdout 保持为空**——stdout 是管道里的脚本，不能被错误信息污染）；新增 `src/cli/commands/completions/bash.ts` 与 `powershell.ts`（纯字符串数组 `.join('\n') + '\n'`，**刻意不用模板字面量**：脚本本身满是 `${...}`/`$(...)`，写成模板字面量会被 TS 先吃掉；纯 ASCII，避开 PowerShell 5.1 的 UTF-16LE 输出与编码意外）；`src/cli/index.ts` 注册路由 + 头注释 + usage + `completions options` 段；`package.json` 的 test 脚本按字母序登记 `test/completions.test.ts`。
- **补全三层**：① 子命令；② 各命令自己的 flag（当前词以 `-` 开头才给、按命令过滤：`add`→`--name/--ref/--subdir/--yes`，`list`→`--names`，`remove|rm`→`--yes`，`doctor`→`--json/--updates/--quiet`，`completions`→`--shell`，`update/pull/enable/disable` 无 flag）；③ 已安装 skill 名——`update|pull|remove|rm|enable|disable` 的首个位置参数，数据经 `dsh-skills-nexus list --names` 取，**绝不读 `manifest.json`**（延续 P0 的解耦决策，有断言钉住）。`completions --shell` 的值补 `bash|powershell`。
- **关键设计（位置参数按「忽略 `-` 开头词后的计数」判定，而非固定槽位）**：`remove --yes <TAB>` 也必须给 skill 名——`parseRemoveArgs` 允许 flag 出现在名字之前（flags 与位置参数各自独立收集）。若用固定槽位（bash 的 `COMP_CWORD -eq 2`、PowerShell 的 `$slot -eq 0`），`--yes` 会白占一个槽位、补全静默失效；改成「光标前的词里不以 `-` 开头的个数为 0」后两种 shell 都正确。安全性前提：走这条分支的六个命令都没有取值型 flag，故 flag 的取值不可能被误计为位置参数——给其中任一命令加取值 flag 会破坏该不变量，已写进两个模板的注释。
- **关键设计（PowerShell 的引擎契约，全部实测而非推断；PS 5.1.26100.9444）**：① 必须 `-Native` 注册——npm 的 `.ps1` shim 解析为 `ExternalScript`，`-Native` 注册**确实会触发**，不带 `-Native` 的注册收到错乱签名（`cmd=[ba] param=[dsh-skills-nexus ba] word=[19]`）不可用；② `CommandElements` 只含已完成 token 加光标处 token（**仅当非空**），尾随空格**不**新增元素（实测 `completions --shell ` → `nelse=3`），故 `$done-2` 为负恰在补子命令时——若把尾随空格当元素会让槽位整体错位、在用户打参数时补出子命令；③ **裸 `-`/`--` 的引擎限制**：光标处词恰为 `-` 或 `--` 时 PowerShell **不调用任何**参数补全器（用 `git` 注册同一探针作对照，`git --`、`git -` 同样不触发）→ `doctor --` 无候选。这是引擎行为、补全脚本无从补救；多打一个字符（`doctor --j`→`--json`）即正常。bash 无此限制（`doctor --` 正常列出三个 flag），该差异已写入模板注释；④ 无候选时 PowerShell 回落到**文件名补全**（模板无法抑制），bash 不回落到文件名。
- **漂移护栏（模板与 CLI 的双份清单如何防锈）**：子命令清单的真值从 `src/cli/index.ts` 的 `case` 标签直接抽取（不另抄一份，否则只是「抄件等于抄件」），并先断言抽取结果 ≥10 条，防正则空匹配导致整套比对假绿；flag 清单从 `--help` 文本抽取（`--help` 是用户契约），逐条断言两个模板都提供。另钉：两模板**不得**为 `update|pull` 广告 `--yes`（`update()` 只读位置参数、从不解析 flag，广告一个不存在的 flag 会误导）、必须含 `list --names`、必须不含 `manifest.json`、必须纯 ASCII、`${...}`/`$(...)` 必须原样出现在产物里（若被改写成模板字面量就会被吃掉）。
- **不做**：不出 zsh / fish 模板（P2；各自 DSL 独立，且 zsh 那份需重写——初稿里 `update|pull`/`remove|rm` 会先命中只含 `--yes` 的分支，导致动态补全分支永不可达）；不提供 `--help` 未公开的别名 flag（`-y`/`--force`/`--branch`——补全以帮助文本为契约）；`remove` 的第二个及以后位置参数不补全（v1 只补首个位置参数，`remove A B` 的 B 需手打）；不加 `list --json`（独立轨道）；不引任何第三方依赖（**连 bash-completion 都不依赖**——计划初稿假设 bash 模板需要 `_init_completion`，实际只用 `compgen`/`COMPREPLY`/`COMP_WORDS`，裸 bash 即可工作）；不读 `manifest.json`；不去「修」PowerShell 对裸 `-`/`--` 的行为（不可修，见上）。
- **测试**：新增 `test/completions.test.ts`（20 条）：6 条 `parseCompletionsArgs`（两种写法、缺值、空值、不支持的 shell 不静默回落、位置参数与未知 flag 拒绝）；4 条输出契约（stdout 逐字节等于模板、`--shell=` 与空格写法同字节、用法错误 exit 2 时 stdout 为空、模板以换行结尾）；7 条漂移与不变量（见上，含 PowerShell 位置参数规则的**文本锚**：CI runner 无 PowerShell，该规则无法执行验证，故以正则钉住、并禁止退回 `$slot -eq` 的槽位比较）；1 条**在真实 bash 中执行模板**的端到端用例（12 个场景，判据为 `label|候选` 行）：模板经环境变量传入子进程 `eval`（避免它的 `${...}`/`$(...)` 被上一级先展开），并用临时目录里的 stub `dsh-skills-nexus` 回答 `list --names`，使动态层用固定数据（`alpha`/`beta`）断言、不依赖开发者本机装了什么；无 bash 时该用例 skip（Windows 开发机），CI（runner 自带 bash）执行。全量 `npm test` **242 通过**（基线 222，+20）。
- **验证方式**：聚焦 `node --import tsx --test test/completions.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表）；四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`）/ `npm test` / `npm run build` 退出码均为 0；`lib/` 随源码重建（新增 `lib/cli/commands/completions.js` 与 `lib/cli/commands/completions/`，`lib/cli/index.js` 更新）。**PowerShell 端到端实测**（把 `dsh-skills-nexus completions --shell powershell` 的**真实产物** `Invoke-Expression` 装载后，用 `[System.Management.Automation.CommandCompletion]::CompleteInput` 逐例测量；隔离 `DSH_HOME` 内注册 `alpha`/`beta`）：子命令 12 条全列；`d`→`disable doctor`；`add --n`→`--name`；`doctor --j`→`--json`；`completions --shell `→`bash powershell`；`completions --shell b`→`bash`；`update `→`alpha beta`；**`rm --yes ` / `remove --yes `→`alpha beta`（本轮修复点）**；`enable al`→`alpha`；`update --x`→空（该命令无 flag）；`remove alpha `、`doctor -- `→空且回落 25 个文件名（引擎回落）。**bash 端到端实测**（Git Bash 5.2.37，直接设 `COMP_WORDS`/`COMP_CWORD` 调模板函数，18 个场景）：子命令 12 条；`d`→`disable doctor`；`add --`→全部 4 个 flag；`doctor --`→全部 3 个 flag（PS 做不到、bash 可以）；`completions --shell b`→`bash`；`update `/`rm `→`alpha beta`（取自隔离 `DSH_HOME`）；`update --x`、`update alpha `→空。辨识指纹：用例数 222 → 242；可执行 bash 用例在把 Git 从 PATH 移除时 18 通过 / 1 跳过、加回后 19 通过 / 0 跳过（同一套件两次运行，证明它既真跑、也会正确 skip）；负向对照：把 bash 的 `nargs` 计数改成不忽略 flag（即退回槽位语义）并删掉 PowerShell 的 `$nargs` 计数行，聚焦套件 **pass 18 / fail 2**——文本锚转红、可执行用例以 `remove-yes|` ≠ `remove-yes|alpha beta` 转红，复原后 20/20 绿。另删掉 `test/completions.test.ts` 里一条无效的 `eslint-disable` 指令（全仓 `eslint .` 因此从「1 warning」回到零告警）。

**2026-09-20 · Added · 新增 `list --names`：仅输出 skill 名的机器可读路径（命令自动补全的动态数据源）**

- **背景**：命令自动补全的第三层需要「已安装的 skill 名」这一动态数据。补全脚本若直接读 `~/.dsh/skills-nexus/manifest.json`，就把 nexus 的内部存储 schema 固化进了 shell 脚本，未来 schema 演进会静默打断补全（git 的教训：补全分支名走 `for-each-ref` 而非读 `.git/refs/`，正因 loose → packed-refs → reftable 演进过）。故先补一个只输出名字的 CLI 路径作为数据源，让补全经 CLI 取数、与内部格式解耦；同时避免为解析 JSON 而引入 `jq` 等外部依赖。
- **变更**：`src/cli/args.ts` 新增 `ListOptions` 与 `parseListArgs`；`src/cli/commands/list.ts` 的 `list(_argv)` 改为消费 argv，`--names` 时按 manifest 顺序每行输出一个 `s.name`，无表头 / 列补齐 / 页脚，空 manifest 输出空串（不打印人类提示 `No skills registered.`，该提示在按行 split 的消费端是噪音）。退出码：`0`=正常、`1`=manifest 不可读、`2`=用法错误。`src/cli/index.ts` 头注释、usage 与新增的 `list options` 段登记 `--names`。
- **关键设计**：`list` 与 `list --names` 是同一命令的两条输出契约——人类表格逐字不变，机器路径 stdout 可直接按行消费（因此用法错误时 stdout 必须保持为空，错误只走 stderr）。`--names` 拒绝内联值（同 `--yes`/`--json` 的布尔护栏：`--names=false` 若静默变 `true`，会让要表格的调用方拿到名字流）；与 `add` 容忍未知 flag 不同，`list` 无位置参数形态，未知参数一律用法错误——否则 `--name` 这类笔误会静默打印整张表格给按行消费的脚本。
- **不做**：不加 `list --json`（作为独立的机器接口基座另行立项，本次补全不需要它）；不改表格列与人类路径输出；不引任何依赖；补全脚本本身（`completions` 子命令与各 shell 模板）不在本次范围。
- **测试**：`test/args.test.ts` 新增 4 条钉 `parseListArgs`（默认表格、`--names` 开启、内联值拒绝、位置参数/未知 flag 拒绝）；`test/list.test.ts` 新增 4 条端到端（名字逐行且无表头页脚、空 manifest 无输出、`--names=false` exit 2 且 stdout 为空、未知参数 exit 2 且 stdout 为空），并把 stdout 捕获 helper 扩展为同时捕获 stderr 以断言机器路径 stdout 纯净。全量 `npm test` **222 通过**（基线 214，+8）。
- **验证方式**：聚焦跑 `node --import tsx --test test/list.test.ts test/args.test.ts`（43/43，勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`（222/222）；四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`）/ `npm test` / `npm run build` 退出码均为 0，`lib/` 随源码重建（漂移范围恰为 `args`、`commands/list`、`cli/index` 三组，无意外产物）。退出码 PowerShell 用 `$LASTEXITCODE`。辨识指纹：用例数 214 → 222；把 `parseListArgs` 里 `--names` 的内联值护栏去掉，聚焦套件 EXIT=1，实测 `test/list.test.ts` 的 `--names=false` 用例断言 `0 !== 2` 失败（`test/args.test.ts` 的同名护栏用例一并转红），已复原。

**2026-09-19 · Added · 新增只读全量体检命令 `doctor [--json] [--updates] [--quiet]`（承载 `health.ts` 诊断能力，`apply()` 保持 no-op）**

- **背景**：symlink 完整性诊断能力此前只以内部函数形式存在于 `src/health.ts`，没有面向用户的入口；插件 `apply()` 是刻意的空操作（启动期警告在 DSH 里没有可验证的可见输出通道）。用户不会总跑 `list`，需要一个一条命令即可体检全部 nexus 状态、并给出可执行修复提示的只读入口，故新增 `doctor` CLI 命令承载该能力。
- **变更**：新增 `src/cli/commands/doctor.ts`，导出 `parseDoctorArgs` / `runChecks` / `formatHuman` / `doctor`。默认全本地、瞬时：依次跑 `manifest` / `roots` / `symlinks` / `orphan-repo` / `orphan-link` / `git-sanity` 六项检查；`--updates` 追加联网的 `updates` 检查；`--json` 输出稳定机器契约（`version: 1`，issue 内联于各 `check`、无顶层 `issues` 数组）；`--quiet` 在无 error 时静默。退出码 `0`=无 error、`1`=至少一个 error、`2`=用法错误。`src/cli/index.ts` 注册 `doctor` 路由与 usage/help。`src/git.ts` 新增 `lsRemoteCommit(url, ref)`（`git ls-remote`，15s 超时，任何失败返回 `undefined`），供 `--updates` 判定分支 pin 是否落后。`src/health.ts`：移除不可达的 `broken-link` 死代码（`EntryDiagnosis` 收敛为 `'ok' | 'disabled' | 'missing-target'`）、修正陈旧 JSDoc（原称由 `apply()` fire-and-forget 调用，实际由 `doctor` 承载、不接入启动路径），新增 `findOrphanRepos()` 与 `findOrphanLinks()`（orphan-link 三分类）。`package.json` 的 `test` 脚本按字母序登记 `test/doctor.test.ts`；`lib/` 随源码重建。
- **关键设计（边界保护）**：`doctor` 只读、绝不修改任何状态、不接入 `apply()`。对无法确认归属 nexus 的文件系统对象（`readlink` 失败的 symlink → `unreadable-link`）只报 `warn` 且绝不给删除提示。`manifest` 严格区分「文件缺失=ok（全新安装，一切为空是合法的）」与「存在但损坏=error（`corrupt-manifest`）」；损坏时条目归属未知，`orphan-repo`/`orphan-link` 检查被**跳过**（标 `warn`、明确「不建议删除」），而不是把每个健康克隆/软链误判为孤立并附删除提示——否则会诱导用户误删自有技能。逐条结构校验 `isWellFormedEntry`（只校 `SkillEntry` 必填字符串字段）防止畸形条目流入 `repoDir(undefined)` 抛穿，保证 `doctor` 始终产出结构化报告。`--updates` 对 detached HEAD（tag/commit pin）报 `locked`（info）、绝不报「落后」；`updates` 结果为 info 级，不计入 errors/warnings、不影响退出码。
- **不做**：不自动修复任何问题；不在 `apply()` 里调用体检；不引任何第三方依赖；布尔 flag 不支持内联值（`--json=x` 按用法错误 exit 2，避免像手写 argv 解析器那样把 `--json=false` 静默变成 `true`）；`orphan-link` 的 `unreadable-link`/`dangling-link` 子类不在 shell 验证流程里手工构造（跨平台创建「野」symlink 脆弱），改由测试确定性覆盖。
- **测试**：新增 `test/doctor.test.ts`（16 条）——覆盖全新安装全 ok、健康安装、断链 → `missing-target`（exit 1，且 orphan-link 不重复上报）、orphan-repo / orphan-link / dangling-link、损坏 manifest、`.corrupt-` 备份、缺 `.git`、`--json` version-1 契约、`--quiet`、用法错误（exit 2）、`parseDoctorArgs`、`formatHuman`，并含两条边界保护回归锚点：**损坏 manifest 抑制 orphan 检查（不产生批量误删的误报）** 与 **畸形条目被结构化上报、绝不抛穿**。`test/health.test.ts` 扩充 `findOrphanRepos`/`findOrphanLinks` 三分类用例，并把既有「多问题 `formatWarning`」用例里的 `broken-link` 改为 `missing-target`（随死代码移除）。全量 `npm test` **214 通过**。
- **验证方式**：聚焦跑 `node --import tsx --test test/doctor.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；四步门禁 `npm run typecheck` / `npm run lint`（全仓 `eslint .`）/ `npm test` / `npm run build` 退出码均为 0，另 `npm run test:build` 编译 src+test 无类型错误。退出码 PowerShell 用 `$LASTEXITCODE`、Git Bash 用 `echo $?`。辨识指纹：把 `runChecks` 里的 `trusted` 门控去掉（损坏 manifest 仍跑 orphan 检查），「corrupt manifest suppresses orphan checks」那条转**红**（健康克隆/软链被误报为 orphan 且带 `remove` 提示）；把 `isWellFormedEntry` 校验去掉，「malformed entry ... does not throw」那条因 `repoDir(undefined)` 抛 `TypeError` 转**红**。
- **文档**：新增双语验证指南 `docs/verify-doctor.md` / `.zh-CN.md`——置顶 Shell 警告、全程用绝对路径与 `git -C` 不 `cd`、隔离临时 `DSH_HOME` + 本地 `file://` 远程（本地检查不联网），含测试套件说明、按平台的端到端场景（全新安装 / 健康 / orphan-repo / missing-target / 损坏 manifest / manifest 漂移 / `--updates` 版本锁感知）、以及「读懂报告」参考表（检查项 / 状态→标签→计数 / 退出码 / 各 issue code 的含义与修复建议 / `--json` 契约）。README 中英用法段各补 `doctor` 一行、文档索引各补链接；CONTRIBUTING 中英验证索引各补一条。

**2026-09-17 · Added · 新增 symlink 完整性诊断模块 `src/health.ts`（供未来 `doctor` 命令复用）；`apply()` 保持 no-op**

- **背景**：插件层 `apply()` 长期是字面 no-op。最初尝试在 `apply()` 里做启动时断链检测并 warn，但实测发现：DSH 的 Cordis context 提供 `ctx.logger`，warn 被路由进 DSH 内部日志系统，终端不可见；若改走 `console.warn` 保证可见性，则牺牲宿主日志路由/级别控制的 proper integration，不合适。同时确认 `list` 的 DIR 列已能主动发现断链（`stat(repoDir)` 失败显示 `missing`）。结论：启动时被动检测在当前输出通道下价值不成立，砍掉 `apply()` 行为；但诊断能力本身有真实需求（用户不会总跑 `list`，生态中甚至有人专门写插件提醒已安装 skill 的状态），故保留诊断模块作为未来 `doctor` CLI 命令的内部实现。
- **变更**：新增 `src/health.ts`，导出 `diagnoseEntry(entry)`（四态：`'ok' | 'disabled' | 'broken-link' | 'missing-target'`）、`checkHealth()`（遍历全部 manifest entry 收集异常，排除正常 disabled）、`formatWarning(issues)`（人类可读警告文本）。诊断逻辑：遍历 `OFFICIAL_SKILLS_DIR` 下 symlink，`readlink` + `resolve` 比对是否落在 `repoDir(entry.path)` 内（与 `link.ts` 的 `isEntryEnabled()` 同一路径解析策略），命中后 `stat(target)` 验证目录存在性。纯文件系统操作，不联网、不调 git。`src/index.ts` 的 `apply()` **保持 no-op**，仅 JSDoc 注明诊断能力位于 `health.ts`、将由未来 `doctor` 命令承载及不接入启动路径的原因。
- **不做**：不在 `apply()` 中调用健康检查（输出通道不可验证 + 不愿牺牲 proper integration）；不注册 Cordis provider/service；不自动修复；不报告 disabled entry。
- **测试**：新增 `test/health.test.ts`（11 条集成测试），覆盖 `diagnoseEntry` 四态、`checkHealth` 空 manifest / 混合状态 / manifest 不存在、`formatWarning` 空 / 单条 / 多条。`package.json` test 脚本按字母序插入。全量 192/192 通过。
- **验证方式**：`node --import tsx --test test/health.test.ts` 跑单文件，`npm test` 跑全量回归；退出码 PowerShell 用 `$LASTEXITCODE`、Git Bash 用 `echo $?`。辨识指纹：全量用例数 181 → 192（+11）；`node -e "import('./lib/index.js').then(m => m.apply())"` 在任何断链状态下均**无输出**（apply 为 no-op 的回归锚点）；直接调用 `node -e "import('./lib/health.js').then(m => m.checkHealth().then(console.log))"` 在断链环境下返回非空数组。
- **测试修复补充**：推送后 CI 九个矩阵作业全红于 lint 步：`test/health.test.ts` 的 `manifest` 变量赋值后未使用（`@typescript-eslint/no-unused-vars`）。根因：本地门禁只跑了目标文件 lint（`npx eslint src/health.ts src/index.ts`），未覆盖 `test/`；CI 跑的是全仓 `eslint .`。修复：删除该未使用的 `let manifest` 声明与 `before()` 中的动态 import 行（测试经 `paths.MANIFEST_PATH` + `writeFile` 直写 manifest，不需要 manifest 模块引用）。验证：全仓 `npx eslint .` exit 0、`test/health.test.ts` 11/11。教训固化：提交前 lint 必须跑全仓 `eslint .`（与 CI 同命令），目标文件 lint 仅作开发期快速反馈。

**2026-09-15 · Docs · 纠正安装说明：CLI 命令来自全局 npm 安装而非 `dsh plugin add`（README ×2 + `src/index.ts` 注释）**

- **背景**：用户发现 README「安装 nexus」段声称 `dsh plugin --profile web add github:...` + 重启后「`dsh-skills-nexus` CLI 命令就可用了」，与卸载段新加的「坑」提示自相矛盾。经文件系统实测坐实：profile 里已装 nexus 插件（`~/.dsh/profiles/web/node_modules/dsh-skills-nexus` 及多份 `.pnpm` 副本），但全局 npm 前缀无链接（`AppData\Roaming\npm\node_modules\dsh-skills-nexus` = False）、`where.exe dsh-skills-nexus` 找不到——直接证明 `dsh plugin add` 只把包装进 profile 的 node_modules、注册 `apply()` 空操作的 Cordis layer，**从不向 shell PATH 暴露 bin**。错误源头是 `src/index.ts` 第 9–12 行注释（声称该入口让 `dsh plugin add` "makes the CLI command available"），README 照抄。
- **变更**：1. README / README_CN「安装 nexus」段改为以 `npm install -g github:xiaxi626/dsh-skills-nexus` 为获取 CLI 命令的主步骤（注明未发布 npm、发布后可用裸包名；`lib/` 已提交无需构建），删除「重启后 CLI 就可用」错误句；新增引用块说明 `dsh plugin add` 不提供 shell 命令、插件层 `apply()` 为空操作、skill 发现靠 symlink + 官方 provider，故插件层可选、对 CLI 无影响。2. `src/index.ts` 第 9–12 行注释改写为「`dsh plugin add` 只注册空操作 layer、不放命令进 PATH；命令来自全局 npm 安装或 `npm link`」。3. 同段引用块补强：点明插件层**两头都可选**——既不影响 CLI，skill 加载也不需要它（发现全靠 symlink + 官方 provider）。4. README / README_CN 本地测试段补「本地测试后的清理」小节（`--patch` 不写 profile、无插件可移除，只需清 skill 数据 + `npm link`，引用卸载段第 1、3 项）。5. `docs/verify-plugin-install.md` 与 `.zh-CN.md` 前置说明各补一条「隔离信号」：cold boot [c] 前确保 `~/.dsh/skills/` 无指向 nexus 的悬空 symlink，避免残留坏链接给 filesystem provider 扫描掺入与本契约无关的噪音。6. 修正下方 2026-09-14 条目「卸载步骤补 `where.exe` 核对」的失实表述——README 从未写入 `where.exe`，且它是 Windows 专有命令、跨平台文档不宜采用，故不纳入。
- **提交拆分**：README ×2 + verify-plugin-install ×2 + CHANGELOG 为纯文档（`docs:`）；`src/index.ts` 为源码文件注释修正，按项目约定与文档分开原子提交。`src/index.ts` 仅改注释、无行为变化；因 tsconfig 未开 `removeComments`、注释会写进 `lib/index.js`，已跑 `npm run build` 重建（`lib/index.js` 第 9–14 行同步为新注释），构建退出码 0。

**2026-09-14 · Added · `add`/`update` 网络等待期新增 TTY 门控 spinner 与多目标 `[i/N]` 批量计数器**

- **背景**：`add`/`update` 的唯一慢点是**网络单发调用**——`add` 的 `getDefaultBranch`（`git ls-remote`）与 `cloneRepo`（`git clone --depth 1`），`update` 的 `pullRepo`（`git pull`）。此前这些调用期间终端完全静默，大仓库或慢网络下像卡死。而 `remove`/`list`/`enable`/`disable` 全是本地 FS 瞬时操作，加进度反馈只会一闪而过、反成噪音，故本次不碰。pip 式**百分比**条需要预知总量，而 `git clone --depth 1` 走的是 `execFileAsync`（缓冲、不流式），要拿真实百分比得把 `git.ts` 改成 `spawn` 并解析 git stderr 进度行、牵动 retry 与测试，侵入过大；单次网络调用本就不知百分比，硬凑百分比反而**不诚实**，故采用**不确定态 spinner（转圈 + 已用秒数）**。
- **变更**：新增叶子模块 `src/cli/progress.ts`（**零第三方依赖**，仅用 `node:process`），导出三样：`startSpinner(message)`→`{ update, stop }`、`withSpinner(message, fn)`（`try/finally` 保证抛错也停表，失败 clone/pull 不留卡死动画）、`batchPrefix(i, N)`（`N>1` 才返回 `[i/N] `）。`add.ts`：`getDefaultBranch`/`cloneRepo` 用 `withSpinner` 包裹；多 spec 时循环体前打印 `[i/N] <spec>` 头行。`update.ts`：`pullRepo` 用 `withSpinner` 包裹；多目标时把 `[i/N]` 前缀加到既有 `Updating <name> (<ref>)…` 行首。**全部输出走 stderr**（stdout 仍留给命令的结构化结果行），且**只在 `stderr.isTTY` 为真时渲染**——非 TTY（CI / 管道 / 测试 / `> log`）下 spinner 是静默 no-op，`\r`/ANSI 绝不污染被捕获的输出，既有测试（只断言退出码与 manifest 状态、不断言进度文本）保持绿。**渲染前用纯函数 `clampToWidth(text, cols)` 把整行按终端宽度（`stderr.columns`，未知则回退 80）截断、超出以单格 `…` 收尾**：这是修掉「Git Bash / mintty 80 列下刷屏一堆 resolving」的关键——spinner 行（glyph+消息+`… Ns`）一旦超过终端宽度就**换行**，此后 `\r` 只回到**第 2 行**行首、`\x1b[2K` 只擦第 2 行，每帧都把上一帧的第 1 行滞留在滚动缓冲里、越堆越多；把行钳在宽度内即保证任意终端都能单行原地重绘。同时把 spinner 消息本身改短（`resolving default branch`、`cloning (<ref>)`——完整 URL 上一行 stdout 已打印，无需重复），进一步远离截断阈值。仅用 `\r`、擦行 `\x1b[2K`、光标隐/显，Windows Terminal / conhost(Win10+) 与 POSIX 终端皆支持，跨平台 CI 矩阵安全；动画定时器 `unref()` 不吊住事件循环。
- **不做**：不改 `git.ts`（不引 `spawn`、不解析 git 真实百分比）；不给 `remove`/`list`/`toggle` 加进度反馈（瞬时本地操作）；不引任何第三方进度库（`ora`/`cli-progress` 等，违反 CLI dependency-free 约束）；单目标运行不加 `[i/N]` 头（`batchPrefix` 在 `N≤1` 返回空串，输出与今日逐字节一致）。
- **测试**：新增 `test/progress.test.ts`（8 条）——2 条纯单测钉 `batchPrefix`（`N≤1` 空串、`N>1` 得 `[i/N] `）；3 条在测试运行器的非 TTY 环境下断言 `startSpinner` 为静默 no-op（先断言 `!stderr.isTTY` 钉住整个设计前提，再验 `update`/`stop` 可安全重复调用不抛）、`withSpinner` 正常 resolve 包裹值、以及包裹函数 reject 时仍走 `finally` 停表并向外抛；3 条钉 `clampToWidth`（预算内原样返回、超预算截断为恰好 `cols` 长且以 `…` 收尾、退化预算 `1`→`…` / `0`→空串），把「行不超宽→不换行」这条修复前提固化。`package.json` 的 `test` 脚本硬编码列表按字母序插入 `test/progress.test.ts`。既有 `add`/`update` 集成测因非 TTY no-op、stdout 契约未变而全绿。
- **验证方式**：聚焦跑 `node --import tsx --test test/progress.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；退出码 PowerShell 用 `$LASTEXITCODE`、Git Bash 用 `echo $?`。辨识指纹：全量用例数 **173 → 181**（+8）；把 `progress.ts` 的 TTY 门控去掉（无条件渲染），`test/progress.test.ts` 的 no-op 那条为**红**；把 `clampToWidth` 改成恒等返回（不截断），其 3 条用例为**红**。本机（Windows / PowerShell，非 TTY）实测 `progress.test.ts` 8/8、`npm test` 181/181 全通过，门禁 typecheck / lint（`npx eslint` 目标文件 EXIT=0）/ test / build 均 0；`lib/` 随源码重建（新增 `cli/progress.js`+`.js.map`+`.d.ts`+`.d.ts.map`，`cli/commands/add.js`、`update.js` 及对应 `.d.ts`/`.map` 更新）。**注**：spinner 的原地重绘依赖真实 TTY，非交互环境无法复现，本机修复以 `clampToWidth` 单测 + 宽度算术为证据（旧 spinner 行约 83 列 > mintty 默认 80 列故换行刷屏，钳宽后 ≤ 宽度不换行）。
- **真 TTY 目视 A/B（限推送前）**：推送前 `origin` 不含 spinner，可把「远程旧版」与「本地新版」并排各跑一次、肉眼对比。思路：`git clone` 取远程码（不受 npm 的 EALLOWGIT 限制）、复用本地依赖免 `npm install`，再按绝对路径直调两版入口。**必须在交互式终端跑**——spinner 只在 TTY 渲染，管道/重定向下静默：

```powershell
# 先把 $local 改成你的工作区路径（例：c:/Users/you/Downloads/dsh-skills-nexus）
$local = "<本地仓库路径>"

# ── 远程版（committed lib，无 spinner）──────────────────────────
git clone --depth 1 https://github.com/xiaxi626/dsh-skills-nexus "$env:TEMP/nexus-remote"
Copy-Item -Recurse -Force "$local/node_modules" "$env:TEMP/nexus-remote/node_modules"   # 复用 yaml，免 npm install
node "$env:TEMP/nexus-remote/lib/cli/index.js" add github:xiaxi626/theme-port-skill       # 观察：网络等待期【完全静默】
node "$env:TEMP/nexus-remote/lib/cli/index.js" remove '*' --yes

# ── 本地版（工作区 lib，有 spinner）────────────────────────────
node "$local/lib/cli/index.js" add github:xiaxi626/theme-port-skill                        # 观察：【转圈 + 已用秒数】
node "$local/lib/cli/index.js" remove '*' --yes

# ── 收尾：删临时远程克隆（真实目录，安全）──────────────────────
Remove-Item -Recurse -Force "$env:TEMP/nexus-remote"
```

Git Bash 把 `$env:TEMP` / `Copy-Item` / `Remove-Item -Recurse -Force` 换成 `/tmp` / `cp -r` / `rm -rf`（两套语法勿混用，否则报 `Invalid argument`）。**为何远程静默**：nexus 内部 clone 走 `execFileAsync`（缓冲、子进程无 TTY），git 原生 `Receiving objects: %` 被抑制；而手敲 `git clone` 在终端看到的 % 是 git 直连 TTY 的自带进度，与 `nexus add` 无关。推送后远程==本地、对比即失效。

**2026-09-14 · Docs · README 卸载 / 本地测试段修正：补 npm 全局链接清理、移除危险裸相对路径删除、纠正 --patch 不提供 shell CLI 的错误表述**

- **背景**：用户实测发现「`dsh plugin remove` 后再从 GitHub 安装，裸 `dsh-skills-nexus` 仍解析到本地构建」（以为在测远程、实际在测本地）。根因是 nexus 实际留下**三个互相独立的产物**——profile 插件层（`dsh plugin add`）、npm 全局 CLI 链接（`npm link`）、skill 数据（`add`）——而 README 卸载段只覆盖插件层与数据，**漏了 `npm link` 创建的全局 CLI 链接**；`dsh plugin remove` 与 `npm uninstall -g` 互不连带，故插件删了全局链接仍在。叠加两处文档缺陷：1. 卸载第 4 步 `Remove-Item -Recurse -Force dsh-skills-nexus` 是**裸相对路径**，在 npm 全局前缀目录下跑会误删 bin shim 致 `command not found`（用户已实际踩中）、在项目父目录下跑会删源码树；2. Step 3 错误声称 `--patch` 会「使 CLI 命令可用」，实际 `--patch` 只挂载当次 DSH 进程的临时 layer、不写 profile 也不提供 shell PATH 命令，shell 命令来自 Step 4 的 `npm link`。
- **变更**：README / README_CN 同步四处。1. 卸载段由「表格+散文」改写为**命令+注释**风格（用户反馈表格难懂）：删掉三产物对照表，改为在一个 bash 块里用第1项 skill 数据 / 第2项 profile 插件层 / 第3项 全局 CLI 命令 三段带注释命令（逐条注明各清什么、何时需要），并置顶一条「你在终端敲的 dsh-skills-nexus 只来自第3项（npm link/npm install -g），--patch 与 dsh plugin add 都不提供 shell 命令」的关键提示，点明「装了 GitHub 版却仍跑本地」的根因与真正切远程做法（npm uninstall -g 再 npm install -g github:）。2. 新增「兜底——手动删除」段（仅当 `npm uninstall -g` 不可用）：先 `Remove-Item -Force "$(npm prefix -g)\dsh-skills-nexus*"` 删 bin shim，再 `Remove-Item -Force "$(npm prefix -g)\node_modules\dsh-skills-nexus"` 删链接且**绝不加 `-Recurse`**（链接是指向克隆的 junction，加 `-Recurse` 会顺链接删进源码树）；Git Bash / macOS / Linux 仍只用 `npm uninstall -g`。3. Step 3 改写为「--patch 仅挂载当次进程、不持久化、不提供 shell PATH 命令」。4. 本地测试 EEXIST 方案 B 由手动 `rm -f`/`Remove-Item` 删 shim 改为 `npm uninstall -g dsh-skills-nexus` + `npm link`（全平台一条路）。注：`npm uninstall -g` 对 `npm link` 的链接包同样有效，与是否已发布到 npm 无关，故手动删除仅作兜底而非主路径。
- **纯文档变更**，无源码或行为变化，`lib/` 零漂移；`npm run typecheck` 退出码 0。

**2026-09-13 · Added · `list` 新增 SOURCE 列，显示每个条目的来源仓库 `owner/repo`**

- **背景**：`list` 此前只有 NAME/SUBDIR/REF/COMMIT/DIR/UPDATED，看不出条目来自哪个仓库。用 `--subdir` 从同一集合仓库（如 `trae-community/trae-skills`）挑装多个 skill 时，各条目在 `list` 里彼此独立、无法一眼辨认同源——而来源信息其实早已存在 manifest 的 `gitUrl`/`url` 字段里，只是从未展示。这是「分不清来源」的**可见性**缺口，与「多份独立克隆占磁盘」（P2 共享克隆范畴，见 `docs/subdir-design.md`）是两个独立问题；本次只补前者。
- **变更**：只改 `src/cli/commands/list.ts` 一个源文件。
  - 新增并**导出**纯函数 `sourceLabel(gitUrl)`：从规范化后的 git URL 取末两段（按 `/` 或 `:` 分隔、去掉尾部 `.git`）得到 `owner/repo`，使 `github:o/r`、`https://…/o/r.git`、`git@host:o/r`、`ssh://…` 等不同写法的同一仓库归一到同一标签。**从 `gitUrl` 推、不从原始 `url` 推**，保证同源显示一致。
  - `list` 表格在 **NAME 之后、SUBDIR 之前**插入 SOURCE 列，列宽 `srcW = max(6, 各行 source 长度)`，沿用既有 `padEnd` + 双空格对齐风格；行数据数组相应右移一格，表头与打印行同步。
  - `gitUrl` 缺失时回退 `url`；空 manifest 的提前返回分支（“No skills registered”）不受影响、不打印表头。
- **不做**：不把重复 SOURCE 折叠成「只显示一次、后续留空」的分组视图（逐行重复才利于扫齐与 `grep`，分组/排序是更大改动）；不合并磁盘（同源仍各一份克隆，去重属 P2 共享克隆，按 `docs/subdir-design.md` 的触发条件延后）；不改 manifest 结构（`gitUrl` 早已存在，无需迁移）。
- **测试**：新增 `test/list.test.ts`（10 条）——7 条纯单测覆盖 `sourceLabel` 的 https / scp（`git@host:`）/ `ssh://` / 尾斜杠 / 裸段 / 空串 / 多写法归一；3 条集成测经 `manifest.addEntry` 直接塞条目 + 接管 `process.stdout.write`，断言 SOURCE 表头与派生 `owner/repo`、同源两条目显示相同标签（出现 2 次）、空 manifest 不打印表头。`package.json` 的 `test` 脚本硬编码列表按字母序插入 `test/list.test.ts`。既有 `test/toggle.test.ts` 的 list 用例（断言行首 `/^on\s/`）因 SOURCE 插在 NAME 之后、行首 state 不变而保持绿。
- **验证方式**：聚焦跑 `node --import tsx --test test/list.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；退出码 PowerShell 用 `$LASTEXITCODE`、Git Bash 用 `echo $?`。辨识指纹：全量用例数 **163 → 173**（+10）；换回旧的无 SOURCE 实现，`test/list.test.ts` 的 SOURCE 相关用例为**红**。本机（Windows / PowerShell）实测 `list.test.ts` 10/10、`npm test` 173/173 全通过，四步门禁（typecheck / lint / test / build）退出码均为 0；`lib/` 仅 `cli/commands/list.js`+`.js.map`+`.d.ts`+`.d.ts.map` 随之更新（新增导出 `sourceLabel`，`.d.ts` 相应变化）。CI 的 `lib/` 新鲜度校验（`git diff --exit-code -- lib/`）按设计仅在 ubuntu 跑，以避开 Windows CRLF 误报。
- **文档**：README 中英用法段的 `list` 注释补 SOURCE，集合仓库注意事项各加一句「同源条目可用 `list` 的 SOURCE 列辨认」。本次分两个原子提交：`feat(cli)` 含 `list.ts` / 新测试 / `package.json` / 构建产物（`lib/`）；`docs` 含 README 中英两文件 + 本 CHANGELOG 记录。

**2026-09-12 · Added · CLI `add`/`remove` 支持多目标批量操作，`remove` 支持 `*`/`?` 通配符**

- **背景**：`add` 与 `remove` 此前一次只处理一个目标，且多余的位置参数被**静默丢弃**——`parseAddArgs` 对每个位置参数执行 `spec = a`（末位覆盖），`add owner/a owner/b` 只装 `owner/b`；`remove` 用 `positional()` 只取第一个参数，`remove a b c` 只删 `a`。旧行为被 `test/args.test.ts` 的 `the last positional wins as spec` 用例显式固化。而 `update` 早已支持批量（无参数时更新全部 enabled，并逐项计失败数），`add`/`remove` 的能力缺口与之不一致；`README_CN.md` 甚至用“两条独立 remove 命令”来演示删除多个 skill，印证了管理大量 skill 时的低效。
- **变更**：
  - `parseAddArgs`（`src/cli/args.ts`）返回 `specs: string[]`、收集全部位置参数；新增 `parseRemoveArgs` 返回 `{ patterns, yes }`。`positional()`（单数）保持不动，`update`/`toggle` 零影响。
  - `add`（`src/cli/commands/add.ts`）把单仓库逻辑抽为 `addOne`，主体按 `specs` 顺序循环、逐项独立：一个仓库失败不中断其余，退出码“任一失败即非零”（与 `update` 同构）。原 `return 0`（识别为 dsh-plugin / 用户取消）归为 skipped、`return 1`（各类拒绝）归为 failed，单仓库的输出与退出码逐条不变。
  - **每仓库级选项与多目标互斥**：`--name`/`--ref`/`--subdir` 各自一对一绑定单个仓库，与多个 spec 同时出现时**显式报错 `return 1` 且不安装任何仓库**，取代旧的静默误用。
  - `remove`（`src/cli/commands/remove.ts`）把单条目逻辑抽为 `removeOne`，接受多个 name 与 `*`/`?` 通配符（对已注册 skill 名做整段全匹配）；逐目标独立删除，缺失名计为逐项失败、退出码非零。
  - **多命中删除护栏**：通配符匹配到 **>1** 个 skill 时（删除不可逆），先打印完整待删清单再要求确认（`--yes` 跳过）；在非交互 shell（非 TTY）无法提问时**拒绝执行并 `return 2`**、提示改用 `--yes`，绝不静默批量删除。精确单名与“通配符仅命中 1 个”不触发护栏，行为与今日一致。
  - 新增两个叶子模块：`src/cli/glob.ts`（极简 `*`/`?` 匹配器，转义其余正则特殊字符、`^…$` 锚定；**零第三方依赖**，不引入 glob/minimatch）与 `src/cli/prompt.ts`（从 `add.ts` 提取的 `confirm`，供 `add`/`remove` 共用）。`src/cli/index.ts` 的 `printHelp()` 补 Batch 段说明。
- **不做**：`enable`/`disable`（toggle）批量——超出本次范围，`positional()` 已就位、后续可低成本跟进；未知 flag 拒绝——会破坏现有“unknown flags are ignored”约定；`[…]` 字符类与 `**` 通配——skill 名为扁平 kebab-case，`*`/`?` 已覆盖，字符类转义复杂度高、收益近零；`--ref` 应用于全部 spec——统一按“每仓库选项与多目标互斥”报错，零歧义；`--dry-run`——由“待删清单 + 确认闸”覆盖。
- **测试**：`test/args.test.ts` 19 → 25（重写 `the last positional wins` 为 `all positionals are collected as specs`，`.spec` 断言改 `.specs[0]`，新增 6 条 `parseRemoveArgs` 用例）；`test/add.test.ts` 8 → 11（多仓库一次安装、每仓库选项 + 多 spec 拒绝、逐项失败仍继续）；新增 `test/glob.test.ts`（9 条：`hasMeta` / `globToRegExp` 锚定与转义 / `matchNames` 的 `*`、`?`、字面量、边界）与 `test/remove.test.ts`（10 条：精确名单删、未注册名退 1、无参退 2、多名批量、含缺失名的部分失败退 1、`*`/`?` 通配符加 `--yes` 删除、单命中免确认、多命中非 TTY 无 `--yes` 退 2 且不删、零命中退 1）。
- **验证方式**：聚焦跑 `node --import tsx --test test/glob.test.ts test/remove.test.ts test/args.test.ts test/add.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；退出码 PowerShell 用 `$LASTEXITCODE`、Git Bash 用 `echo $?`。辨识指纹：全量用例数 **135 → 163**（+28 = args +6、glob +9、remove +10、add +3）；换回旧的单目标实现，`test/remove.test.ts` 的批量 / 通配符用例、`test/add.test.ts` 的多仓库用例、以及 `test/args.test.ts` 的 `all positionals are collected as specs` 均为**红**（旧码末位覆盖只留一个 spec）。本机（Windows / PowerShell）实测 `npm test` **163/163** 全通过，四步门禁（typecheck / lint / test / build）退出码均为 0；端到端探针：隔离 `DSH_HOME` 下 `add owner/a owner/b --name x` 退 1 并打印互斥提示、`remove 'foo-*'`（空清单）退 1 打印 “No skills match”。`lib/` 随源码重建（`args`/`add`/`remove`/`index` 更新，新增 `glob`/`prompt`；`index.d.ts` 因导出签名未变而不变，`add.d.ts`/`remove.d.ts` 仅 JSDoc 变化）。
- **文档**：README 中英用法段把“多条独立 remove 命令”改为通配符 / 多参数一条命令，并补 `add` 多仓库、每仓库选项互斥、通配符需加引号（防 shell 提前展开）等说明；`src/cli/index.ts` 的 `printHelp()` 同步补 Batch 段。按项目「功能改动与纯文档分开」约定拆为两个提交：`feat(cli)` 含解析器 / glob / prompt / add / remove / printHelp / 测试 / package.json / 构建产物 / 本 CHANGELOG 记录，`docs` 仅含 README 中英两文件（纯文档）。

## [0.3.0] - 2026-09-11

**2026-09-11 · Docs · 新增 PR 模板，CONTRIBUTING 补「提交与 PR 约定」（Conventional Commits + 功能/文档分拆提交）**

- **背景**：仓库已有双语 CONTRIBUTING、Issue 模板与 PR-on CI，唯独缺 PR 模板；且「功能改动与纯文档分开提交」这条约定此前只散落在 CHANGELOG 叙述里、CONTRIBUTING 从未正式写明，贡献者无从提前知晓。
- **变更**：新增 `.github/PULL_REQUEST_TEMPLATE.md`（英文，与既有 Issue 模板语言一致）——含变更类型、关联 issue、对齐 CI 的质量 checklist、Breaking changes、审阅提示；其中 `lib/` 新鲜度一条如实写明 CI 用 `git diff --exit-code --quiet -- lib/` 校验、且仅在 `ubuntu-latest` 跑（避开 Windows CRLF / `core.autocrlf` 误报）。CONTRIBUTING 中英各新增「Commit & pull request conventions / 提交与 PR 约定」小节，把 Conventional Commits、功能/文档分拆、提交前更新 CHANGELOG、PR 模板入口固化为贡献者可见的正式约定。
- **纯文档 / 仓库元数据变更**，无源码或行为变化，`lib/` 零漂移；PR 模板为纯 Markdown、无 frontmatter，无需 YAML 校验。`npm run typecheck` 退出码 0。

**2026-09-10 · Fixed · `writeManifest` 改为 temp + rename 原子写，防止中断产生空/半截 manifest**

- **背景/根因**：旧实现 `writeFile(MANIFEST_PATH, …)` 用默认 `'w'` 标志——打开即把 `manifest.json` **截断到 0 再写**，正式文件在整个写入期间处于空/半截状态。真正会坐实“空/半截”的是两类**低概率**事件：① 进程在“已截断、未写完”的窗口内被中断（Ctrl+C / kill / 崩溃 / 断电）；② 磁盘写满（ENOSPC）写到一半。（权限不足反而**安全**：卡在 `open()`、旧文件根本没被截断，是干净失败。）由于每次写的都是**整份** manifest，一旦命中即**整个注册表**丢失、不止单条 skill。事后兜底也靠不住：`readManifest` 的 `.corrupt-<ts>` 备份存的是“这次读到的那份损坏内容”，而上一份好数据早在 `open('w')` 截断那一刻就被销毁了，所以备份下来往往是**空串或半截 JSON、救不回上一次的好状态**。旧注释却写着 “atomically (temp file + rename semantics via direct write)”——既无 temp 也无 rename，与实现不符、误导维护者以为已有原子保证。
- **变更**：只改 `writeManifest` 一个叶子函数（`src/manifest.ts`）——先写同目录固定名临时文件 `manifest.json.tmp`，再 `rename` 覆盖正式文件（本机 Windows 实测：`rename` 覆盖已存在文件成功、源 tmp 随即消失；机制上 libuv 在 Windows 走 `MoveFileExW` + `MOVEFILE_REPLACE_EXISTING`、POSIX `rename` 原子替换），失败时在 catch 里 `rm(tmp, { recursive: true, force: true })` 清理后重抛；注释同步改为如实描述。**作用**：正式文件全程不被截断，崩溃时 manifest 要么是旧全量、要么是新全量、**绝不为空/半截**；固定名 temp 至多残留一个、下次写入即截断复用（自愈），只存在于 NEXUS_HOME 内，不污染 `repos/` 与项目目录。`readManifest`/`addEntry`/`removeEntry`/`markUpdated` 的签名与三处调用方零改动。
- **不做**：并发写文件锁（单用户 headless CLI，YAGNI）；已损坏 manifest 的自动重建 / `repair`（属另一个工具——本次只**预防**新损坏、不**治疗**既有损坏）。
- **测试**：`test/manifest.test.ts` 新增 2 条——`writeManifest preserves the previous manifest when the write cannot complete`（判别项：把 `manifest.json.tmp` 注入成一个目录迫使 `writeFile(tmp)` 抛错，断言 `writeManifest` reject、正式文件仍等于上一份好数据、目录内无 `.tmp` 残留）与 `writeManifest leaves no temp file behind`（回归护栏：成功写后目录内无 `.tmp`）。
- **验证方式**：聚焦跑 `node --import tsx --test test/manifest.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；退出码 Git Bash 用 `echo $?`、PowerShell 用 `$LASTEXITCODE`。辨识指纹：该文件用例数 **13 → 15**、`npm test` **133 → 135**；换回旧的直接写实现，判别项那条为**红**（报 `Missing expected rejection.`——旧码无视 `.tmp`、直接截断覆盖、resolve 而非 reject），护栏那条仍**绿**。本机（Windows）实测 `manifest.test.ts` 15/15、`npm test` 135/135 全通过，四步门禁（typecheck / lint / test / build）退出码均 0；`lib/` 仅 `manifest.js`+`.js.map`+`.d.ts`+`.d.ts.map` 随之更新（`.d.ts` 变在 JSDoc 注释、函数签名不变）。CI 的 `lib/` 新鲜度校验（`git diff --exit-code -- lib/`）按设计仅在 ubuntu 跑，以避开 Windows CRLF 误报。

**2026-09-05 · Fixed · 修正 `ensureDescription` 在 CRLF 文件与空值 `description:` 键上的静默失败**

- **背景**：`ensureDescription` 的插入正则写死了 `\n`，而 Git for Windows 默认 `core.autocrlf=true`、`git clone` 检出即 CRLF——正则永不匹配，`String.replace` 静默返回原字符串，`add`/`update` 仍打印 `⚠ added missing description` 成功提示，官方 filesystem provider 随即因缺 description 静默跳过该 skill。另一条高频路径：frontmatter 里已有**空值** `description:` 键时，旧实现会插入第二个同名键，`yaml.parse` 抛 `Map keys must be unique`，`parseFrontmatter` 的 `try/catch` 把整个 frontmatter 降级为 `{}`，同样静默失败。两者都不报错，用户拿到一个“装好了但不存在”的 skill。
- **变更**：只改 `ensureDescription` 一个函数。1. 用现有 `FRONTMATTER_RE` 把 frontmatter 区段切出来，改写只在区段内做、再逐字节拼回，正文永不被触碰；2. 已存在顶层 `description:` 键时就地填值，不再插入重复键；3. 探测文件自身行尾符并按它生成插入行，不再产生混合行尾；4. 替换改用回调而非反向引用风格的替换串，使写入值里的美元符号序列保持字面量；5. 无变化时不写文件。**未改动** `FRONTMATTER_RE`、`parseFrontmatter`、`normalizeSkillName`，故 skill 发现链路（`resolve.ts` → `add`/`list`/`update`/`toggle`）零影响。
- **验收**：对既有正确行为**零回归**——原本就正确的输入（如 LF 文件的两条插入路径）输出逐字节不变、由回归护栏用例钉住；只有原本就出错的输入（CRLF 文件、空值 `description:` 键、正文被误改）行为被修正。
- **不做**：另一个归一化函数 `normalizeSkillName` 的两类既有缺陷本次不修——frontmatter 用引号键（如 `"name":`）时会越过闭栏误改 Markdown 正文里的 `name:` 行（本次已修掉 `ensureDescription` 里的同源问题），以及会误改缩进的嵌套 `name:` 键、却不改真正非法的顶层键。二者触发条件苛刻，且修好也不改变用户可见结果（该场景下 skill 名归一化本就失败、照样被官方 provider 跳过），被误改的正文又位于每轮 `update` 先 `discardLocalChanges` 的一次性托管克隆里、下次更新即自愈；修它们需把改动扩散到第二个函数并推导 frontmatter 缩进，风险与收益不成比例，留待确有需求时另行立项。此外缩进块映射 / 非块映射 frontmatter 产出非法 YAML 属修正前既有缺陷，本次保持原样、不加剧；`name:` 行尾注释仍按设计丢弃（一次性克隆，注释对官方 provider 无语义价值）。
- **测试**：`test/frontmatter.test.ts` 新增 `withSkillFile` helper 与 10 条用例（CRLF 插入 / 空值 `description:` 就地填值 / `description: ""` / CRLF 无 `name` 键不混合行尾 / CRLF 多行 `name` scalar / 正文不被改写 / 已有 description 时不写文件 / LF 两条路径逐字节回归护栏 / 幂等）。修复前 6 条红、4 条绿（特征测试），修复后 10 条全绿，原有 12 条保持绿；四步门禁退出码 0、`lib/` 零漂移。
- **验证方式**：聚焦跑 `node --import tsx --test test/frontmatter.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`；退出码在 Git Bash 用 `echo $?`、PowerShell 用 `$LASTEXITCODE`。辨识指纹：该文件用例数 **12 → 22**，新增末 10 条中前 6 条（CRLF 插入 / 空值 `description:` 就地填值 / `description: ""` / CRLF 无 `name` 键 / CRLF 多行 `name` scalar / 正文不被改写）为修复目标、后 4 条为回归护栏；换回旧实现这 10 条为 **6 红 4 绿**（4 条特征测试本就绿）。本机 Git Bash 实测 `frontmatter.test.ts` 22/22、`npm test` 133/133 全通过，四步门禁退出码均 0、`git status --short` 仅 6 个预期文件。

**2026-09-05 · Added · CLI `add` 参数解析支持 `--flag=value` 等号写法**

- **背景**：`parseAddArgs` 此前只认空格写法，`--name=value` 会被当未知 flag 静默忽略；`--subdir=skills/foo` 尤其危险——用户以为装子目录，实际 subdir 为空、静默退化成整仓安装。`--flag=value` 是 GNU/argparse/Go flag/npm/git/docker/kubectl 通行约定，补齐可减少意外。
- **变更**：`src/cli/args.ts` 的 `parseAddArgs` 在匹配前按**首个** `=` 拆分 `flag`/`inlineVal`，以 `inlineVal ?? argv[++i]` 兼容等号与空格两种写法（`--name/--ref/--branch/--subdir`）。取首个 `=` 是因为 flag 名来自固定集合、永不含 `=`，而值可以含（`--subdir=a=b`、`--ref=feature=x` 均合法）。`??` 短路确保等号写法不多吃 token；spec 分支保留整段 token（`owner/repo=v1` 不误拆）；未知 `--flag=x` 仍忽略。`positional()` 及其他命令不受影响。
- **顺带修复**：布尔 flag（`--yes`/`-y`/`--force`）现在**拒绝带值并抛错**。此前它们直接丢弃 `=` 后的内容，会让 `--yes=false` 静默变成 `yes=true`，从而同时绕过 wrapped-skill 的 plugin 包装层确认（`add.ts` L158-163）与 >20 skill 的大集合护栏（`add.ts` L187，`LARGE_COLLECTION_THRESHOLD=20`）；而更早的行为是 `--yes=false` 被整个忽略。同一判据下 `-y=true` 因不以 `--` 开头曾**顶掉 spec**（实测 `spec:"-y=true"`），现一并消除。
- **测试**：`test/args.test.ts` 新增等号（含 `--branch=`）、等价、`--subdir=` 空值仍抛错、值内含 `=`、含 `=` 的 spec 不被拆、布尔 flag 带值抛错等 **8 条**用例；原有 11 条全绿，合计 19 条（隔离运行实测 `pass=19 fail=0`）。另以新旧实现并排差分、覆盖既存 args 测试的全部输入：行为改变项均属本次意图内修复，既存测试输入 **0 项改变**（零回归经实测、非推断）。全量 `npm test` **123 用例通过**；四步门禁（typecheck / lint / test / build）退出码均为 0、二次 build 幂等、`lib/`（`args.js` / `args.js.map` / `args.d.ts.map`）零漂移（`args.d.ts` 因签名未变而字节相同）。
- **验证方式**：聚焦跑 `node --import tsx --test test/args.test.ts`（勿用 `npm test -- <file>`——会追加到硬编码全量列表），全量回归跑 `npm test`。辨识指纹：该文件用例数 **11 → 19**，新增第 11–18 条（等号 `--name=`/`--ref=`/`--subdir=`、等价、`--subdir=` 空值抛错、值内含 `=`、spec 含 `=` 不拆、布尔带值抛错）全绿即生效；换回旧代码这 8 条为 **7 红 1 绿**（仅 `a spec containing = is not split` 本来就绿）。本机 Git Bash 实测 `args.test.ts` 19/19、`npm test` 123/123 全通过。
- **文档**：README 中英用法段各加一行注（取值型 `--name/--ref/--subdir` 亦支持 `--flag=value`，布尔 `--yes` 不接受值）；`src/cli/index.ts` 的 `printHelp()` Options 段同步补一行，`lib/cli/index.js`（及 `.map`）随之重新构建。按项目「功能改动与纯文档分开」约定拆为两个提交：`feat(cli)` 含解析器 / `printHelp()` / 测试 / 构建产物 / 本 CHANGELOG 记录，`docs` 仅含 README 中英两文件（纯文档）。

**2026-09-05 · Added · `cloneRepo` 对分支/标签克隆增加指数退避重试（弱网健壮性）**

- **背景**：`add`/`update` 的核心是网络克隆，此前 `cloneRepo` 单次调用、网络抖动即失败，需用户手动重跑 `add`（`add.ts` 失败清理注释里的 “retry” 指的是用户手动重跑，非自动重试）。目标用户多为国内环境，GitHub HTTPS 访问抖动频繁，一次退避重试能实打实提升成功率；属「git 版本锁 + headless CLI」核心路径的健壮性补强，**不引入任何运行时依赖**。
- **变更**：`src/git.ts` 新增通用 `retry(fn, { retries, minDelay })`（指数退避 `minDelay * 2^attempt`，导出供测试）；`cloneRepo` 仅对**分支/标签**克隆包一层 `retry({ retries:1, minDelay:500 })`（共 2 次尝试、中间 1 次 500ms 等待）。**commit-SHA 路径不重试**——`--branch <sha>` 是确定性失败（本机实测 `git clone --branch <40位sha>` 恒 `exit=128`、重试后失败完全相同），重试纯属浪费、亦违背「非瞬态错误不应重试」原则；仍走原有 clone+fetch+checkout fallback（该 fallback 行为零变化）。相对最初优化方案修掉一处 bug：原方案无差别重试第一个 `--branch` 克隆，会对 commit-SHA 白等 500ms。
- **对正常克隆零影响（结构性保证）**：首次成功即 `return`，不进 catch、不执行 `setTimeout`、不进第二次循环；成功路径的 git 命令/参数/`dest`/结果与现状逐字节一致。慢克隆的 Promise 一直 pending，retry 只在 `await fn()` 等待、无时间上限——因**不含超时**，不会误伤大仓库/慢网络。失败时 git 自行清理 `dest`（本机实测两种失败后 `dest` 均不残留），`add.ts` 在 `cloneRepo` 抛出后另有一次 `rm(dest)` 兜底。
- **不做超时**（原方案标题含“超时”，本轮移出）：超时会在“正常但慢”的克隆尚未失败时强杀，可能误伤大仓库；且 `getDefaultBranch`(`ls-remote`) 等网络调用未被覆盖，只给 clone 加超时属半成品；一旦引入超时强杀，还需在重试间显式清理 `dest`（会给纯 git 模块引入 `fs` 依赖）。按 YAGNI 移出本轮。
- **测试**：`test/git.test.ts` 新增 3 条 `retry` 单测（首次成功 / 耗尽抛错 calls=3 / 第二次成功）+ 1 条 commit-SHA fallback 特征测试（此前该路径零覆盖，改造前先跑通锁定现状）。本地四步门禁全绿：typecheck / lint 退出码 0、`npm test` **115 用例通过**（较此前 111 增 4）、`npm run build` 退出码 0，`lib/`（`git.js` / `git.d.ts` / 两个 `.map`）已重新生成。另新增验证指南 `docs/verify-clone-retry.md`（中英），其端到端命令统一用 Git Bash 的 `&&` 链在隔离临时目录造仓库，避免误伤真实项目仓库。

**2026-09-05 · Changed · CI 测试矩阵扩展至 ubuntu/windows/macos，新增 link 集成测试覆盖 junction/symlink**

- **背景**：CI 此前仅在 `ubuntu-latest` 上运行（Node 20/22/24），无法验证 `src/link.ts` 中 `symlink(target, path, 'junction')` 的 Windows junction 行为与 macOS/Linux symlink 分支——这是 0.2.0 架构重构（symlink + 官方 Provider）后唯一的平台相关代码路径，且此前无任何测试直接覆盖 `linkSkill`。
- `.github/workflows/ci.yml`：矩阵从单一 `ubuntu-latest` 扩展为 `os: [ubuntu-latest, windows-latest, macos-latest]` × `node: [20, 22, 24]`（9 个 job），`runs-on: ${{ matrix.os }}`，`fail-fast: false` 保持；typecheck / lint / test / build 在三平台全跑。「已提交 `lib/` 与最新构建一致」的校验步骤加 `shell: bash` 并用 `if: matrix.os == 'ubuntu-latest'` 限定只在 ubuntu 执行——`tsc` 产物确定性且与 OS 无关，限定 Linux 可规避 Windows CRLF / `core.autocrlf` 导致的 `git diff` 误报。公开仓库的额外 OS runner 不产生费用，代价仅为排队时间变长。
- **新增 `test/link.test.ts`（7 用例）**：在临时 `DSH_HOME` 上真实调用 `linkSkill → isEntryEnabled → readLinkTarget → unlinkSkill → hasCollision`（不 mock），覆盖链接直指 repo 根（junction 精确匹配分支）、指向 subdir（`startsWith` 分支）、原子重指向、删除后状态翻转、真实目录 vs 托管 symlink 的碰撞判定。`package.json` 的 test 脚本按字母序登记该文件。实测 Windows 上 `readlink` 返回干净绝对路径（无 `\\?\` 前缀），`isEntryEnabled` 的 `resolved === base.slice(0,-1)` 分支命中，junction 行为正确。
- **文档**：CONTRIBUTING 中英新增 actionlint 本地校验小节（安装 `go install github.com/rhysd/actionlint/cmd/actionlint@latest`、仓库根运行 `actionlint`），并说明其故意不接入 CI（GitHub 解析阶段已拒绝非法 workflow，CI 内再跑属冗余，仅作推送前本地检查）；测试覆盖表补 `src/link.ts` 行，CI 段落改写为 OS 矩阵说明。
- 无 `src/` 源码变更，`lib/` 零漂移；本地门禁全绿：`npm test` 111 用例通过、typecheck / lint 退出码 0、`actionlint .github/workflows/ci.yml` 0 errors。
- **CI 实测修正（windows × Node 20，提交后补）**：首次三平台矩阵暴露 1 例失败（9 job 中 8 绿，仅 `windows-latest × Node 20` 挂）——`test/link.test.ts` 的 `linkSkill atomically repoints an existing link` 用 `assert.equal` 裸比较 `readLinkTarget` 原始输出，而 Windows + Node 20 的 `fs.readlink` 读取 junction 会返回**带尾部分隔符**的目标（`...\repo-c1\`），Node 22+ 则去掉。**此为测试断言过严，非产品缺陷**：`readLinkTarget` 在生产代码里只被 `isEntryEnabled` 消费，后者经 `path.resolve` 归一化目标，天然免疫此差异（同文件其余 junction 用例在 Node 20 上均通过；lib/ 校验按 `if: matrix.os == 'ubuntu-latest'` 在 6 个非 ubuntu job 正确 skip，验证 CI 改动本身生效）。修复：新增 `assertLinkTarget()` 辅助函数，比较前对两侧 `resolve()` 归一化并加注释记录该坑；仅改测试，`src/` 未动，本地 111 用例仍全绿、typecheck / lint 退出码 0。

**2026-09-02 · Docs · README 增加贡献入口，新增 Issue 模板（社区优化）**

- README / README_CN：在「文档」索引与「许可证」之间新增独立的「Contributing / 参与贡献」章节，链接 CONTRIBUTING.md / CONTRIBUTING.zh-CN.md 与 issue 提交入口（`issues/new/choose`），降低潜在贡献者找到入口的成本。
- 新增 `.github/ISSUE_TEMPLATE/`：`bug-report.md`（Bug 报告，`labels: bug`）、`feature-request.md`（功能请求，`labels: enhancement`）、`config.yml`（`blank_issues_enabled: false` 禁用空白 issue，附指向 Discussions 的 contact link），引导贡献者结构化提交 issue。
- 纯文档 / 仓库元数据变更，无源码或行为变化；三个模板的 YAML（frontmatter 与 `config.yml`）经项目自带的 `yaml` 依赖解析校验通过。

**2026-08-29 · Fixed · 恢复插件装载契约：`plugin add` 后 `dsh web` 启动必崩（0.2.0 重构回归）**

- **问题**：`dsh plugin --profile <name> add "github:owner/dsh-skills-nexus"` 安装成功后，`dsh web` 冷启动必崩：`failed to import loader entry dsh-skills-nexus (./lib/index.js): Cannot find module '<profile>\lib\index.js'`，整个插件树加载失败。相对路径 entry 一律以 profile 目录为 `baseUrl` 锚点解析（cordis-plugin-loader 的 `new URL(name, baseUrl)`），而包文件在 `node_modules/dsh-skills-nexus/` 下——`<profile>\lib\index.js` 结构性不存在，安装再完整也必崩。卸载插件（从 `dsh.profile.bundles` 层移除）后启动即恢复正常，重装则复发。
- **根因**：0.2.0 架构重构（移除自定义 provider，改 symlink + 官方 Provider）顺手破坏了插件装载契约两处：`cordis.patch.yml` 的 entry 从裸包名 `'dsh-skills-nexus'` 改为相对路径 `'./lib/index.js'`；`package.json` 删除了 `main` 与 `exports["."]`（即使改回裸包名，Node ESM 导入也会因无主入口失败）。重构期间本地验证走的是被 `.gitignore` 忽略、从未入库的 `overlay.yml`（硬编码本机绝对路径），绕过了 node_modules 解析；且入口 `apply()` 为 no-op，插件未被加载不产生任何功能症状，回归一直潜伏到真实用户 `plugin add` 后冷启动才暴露。0.1.0（`6486287`）裸包名 + `main` 契约经 dsh 源码验证可正常解析（`internal.import(name, baseUrl)` → profile 目录 node_modules → 包主入口）。
- **修复**：最小恢复旧装载契约，不回滚重构——`cordis.patch.yml` entry 改回 `name: 'dsh-skills-nexus'`；`package.json` 恢复 `"main": "lib/index.js"` 与 `exports["."]`（按当前 `lib/` 布局，非旧版 `lib/types/` 路径）。`apply()` 保持 no-op，symlink + 官方 Provider 的发现机制、`peerDependencies` 删除等重构成果全部保留；包加载与否对 skill 功能零影响，此修复只是让官方安装渠道重新可用。
- **测试**：本地四步门禁全部通过（104 用例全绿，`lib/` 零漂移）；端到端实测：`dsh plugin --profile web add <本地包>` 后 `dsh web` 冷启动成功（无 loader 报错），随后 `plugin remove` 清理复原。
- **文档**：新增 `docs/verify-plugin-install.md` / `.zh-CN.md`——插件装载契约验证指南（指导向，事故经过仅存于本 CHANGELOG）：开篇声明验证对象（安装注册 + 冷启动加载）与契约两要素（裸包名 entry + `main`/`exports["."]`）、质量门禁 + 三项契约静态检查、按平台（Windows Git Bash / macOS / Linux）的端到端命令块（本地 `file:` 源代替未推送的 `github:`，安装 → bundles 注册确认 → 冷启动 → 探活 → 卸载清理）、判定标准表、推送后真实 `github:` 复验步骤；明确本流程会写入真实 `~/.dsh/profiles/web/` 且不涉及符号链接权限。两份 README 文档索引补链接。

**2026-08-28 · Changed · CI actions 升级 v5（Node 24 运行时），测试矩阵改为 Node 20/22/24**

- **背景**：Node.js 20 于 2026-04 EOL，GitHub Actions runner 自 2026-06 起将仍声明 node20 运行时的 JS Action 强制跑在 Node.js 24 上，并在运行日志中打印弃用警告。根因是 `actions/checkout@v4` / `actions/setup-node@v4` 两个 action 自身以 node20 为目标运行时，与 `package.json` 的 `engines` 字段无关（`engines` 不参与 Action 运行时选择，矩阵里的 `node-version` 也只影响作业步骤、不影响 action 本体）；本地无警告是因为该提示由 GitHub 平台注入，非 npm / tsc 输出。
- `.github/workflows/ci.yml`：`actions/checkout@v4` → `v5`、`actions/setup-node@v4` → `v5`（两者均以 node24 为目标运行时，v5 要求 runner ≥ v2.327.1，`ubuntu-latest` 满足）；矩阵 `[18, 20, 22]` → `[20, 22, 24]`（Node 18 已于 2025-04 EOL，24 为当前 LTS）。显式 `cache: npm` 保持不变；本项目无 `packageManager` 字段，不受 v5 自动包管理器缓存探测的 breaking change 影响。
- `package.json`：`engines.node` 从 `>=18.0.0` 提升至 `>=20.0.0`，与 CI 矩阵下限一致。`@types/node` 保持 `^20.14.0`——类型包应对齐最低支持版本，防止误用更高版本 API（CI 在 Node 20 上实跑测试已兜底运行时兼容性）。
- `tsconfig.json` 无需调整：`target: ES2022` / `lib: ES2023` 的输出在 Node 20/22/24 上均完整支持。
- 联动同步 6 处旧矩阵引用：`CONTRIBUTING.md` / `.zh-CN.md`、`docs/verify-version-lock.md` / `.zh-CN.md`、`docs/verify-collection-support.md` / `.zh-CN.md`。
- 无源码与行为变化；本地四步门禁（typecheck → lint → test → build）全部通过，104 用例全绿，`lib/` 构建零漂移。

**2026-08-27 · Docs · README 分层重构：精简根 README，架构与贡献指南外移至 docs/ 和 CONTRIBUTING**

- README 从 521 行精简至 266 行（-49%），README_CN 从 437 行精简至 196 行（-55%）。安装、使用、卸载、本地测试、轻量验证、注意事项等用户操作链完整保留在根 README 中，未拆散。
- 新增 `docs/ARCHITECTURE.md` / `.zh-CN.md`：架构概览（Mermaid 数据流图）、工作原理（pipeline + 设计要点）、SKILL.md 发现规则（3 种布局 + frontmatter 字段）、文件系统布局（两层目录设计 + 环境变量覆盖）从 README 外移至此。
- 新增 `CONTRIBUTING.md` / `.zh-CN.md`：项目结构（`src/` 源码树 + 逐文件说明）、测试与 CI（质量门禁命令 + 测试覆盖表 + CI 矩阵）从 README 外移至此；含本地测试步骤的回链。
- 两个 README 底部新增 Documentation / 文档索引章节，汇总所有 docs/ 链接及 CONTRIBUTING、CHANGELOG 入口。
- 纯文档变更，无代码或行为变化；`npm run typecheck` 通过。

**2026-08-27 · Docs · README 使用段补充 `--name` 示例与条目名回退链说明**

- README / README_CN 的「使用」代码块在 `--subdir` 示例后新增一行：`dsh-skills-nexus add github:owner/repo --subdir skills --name owner-skills`，注释写明条目名回退链（`--name` > subdir 末段 > 仓库名）。背景：集合级子目录（如 `--subdir skills`）默认条目名会取到毫无区分度的末段名 `skills`，跨仓库撞名时只能靠 `--name` 消歧，但此前使用段未展示该参数。仅文档变更，无行为变化。

**2026-08-26 · Fixed · 多 skill 条目的状态反查改为按链接目标（修复 list 误报 off / disable 空转 / 裸 update 跳过）**

- **问题**：建链接与查状态用了两把不同的钥匙——多 skill 仓库的 symlink 按每个 skill 的 frontmatter 名创建（如 `skill-01`…`skill-21`），从不以条目名命名；而 `list` / `disable` 前置判断 / 裸 `update` 目标过滤都用 `isLinked(条目名)` 按名字查，查不到就把条目误判为未启用。后果：`list` 对已启用的多 skill 条目显示 `off`；`disable` 打印 `already disabled` 静默空转（链接一个都没删）；裸 `update` 把多 skill 条目整个跳过。单 skill 仓库因条目名＝链接名而未受影响。
- **修复**：`src/link.ts` 新增 `isEntryEnabled(entry)`——扫描官方 skills 根目录，凡有 symlink 目标落在该条目克隆目录内即视为启用；与链接命名规则解耦，单/多 skill、subdir 条目均正确，且不要求克隆存在。`list` / `toggle`（前置判断）/ `update`（默认目标过滤与重建链接前的 `wasLinked` 判断）全部改用它。
- **测试**：新增 `test/toggle.test.ts` 3 条用例（多 skill 条目 disable 真删链接/enable 恢复、裸 update 包含已启用条目且跳过已禁用条目、list 显示 `on`），并登记到 `package.json` 的 test 脚本。
- **文档**：verify-collection-support 中英新增 `[g2]` 步骤（多 skill 条目开关验证）、`[g]` 期望输出补 `list` 行首为 `on`、测试表补 `test/toggle.test.ts` 行。

**2026-08-26 · Fixed · `update` 不再被脏工作区阻塞（归一化产物与 git 操作冲突）**

- **问题**：安装时归一化（`ensureDescription` / `normalizeSkillName`）会原地改写克隆内的 `SKILL.md`，导致工作区变脏。凡需要归一化的仓库（frontmatter 缺 description / 名称不合法——正是归一化存在的意义），后续 `update` 必然失败：分支 pin 的 `git pull --ff-only` 报 `Your local changes would be overwritten by merge`，tag/commit pin 的漂移恢复 `git checkout` 同样被阻断。verify-version-lock walkthrough 的 B / C 步骤实测复现。
- **修复**：`update` 在 pull / 恢复前先检测脏工作区，脏则打印 `⚠ discarding local changes in nexus-managed clone` 后丢弃（`git reset --hard` + `git clean -fd`）再继续；干净克隆行为零变化。不影响「安装时归一化」功能：`add` 流程不变，`update` 的 pull 后重新归一化照常执行（该逻辑本就是为「pull 会覆盖归一化修复」而设计），命令结束时 SKILL.md 仍为归一化终态；同时恢复了 changelog 已承诺的分支快进与漂移自愈能力。
- **新增**：`src/git.ts` 的 `isDirtyWorktree` / `discardLocalChanges`。
- **测试**：`test/git.test.ts` 新增脏检测/丢弃单测；`test/update.test.ts` 新增 2 条回归测试（脏克隆下分支快进、脏克隆下漂移恢复）。
- **文档**：verify-version-lock 中英新增 B2 步骤（脏克隆 walkthrough）、期望输出行、坑 #10（归一化弄脏克隆）与坑 #11（脏克隆也会阻塞手动 git 命令——因此把演示用初始 `SKILL.md` 改为 frontmatter 置于文件开头的合法格式，否则 C 步的手动 `git checkout FETCH_HEAD` 会被 git 拒绝）；4 份验证文档的 `ls -la ~/.dsh/skills/` 修正为 `ls -la "$DSH_HOME/skills/"`（设置演示 `DSH_HOME` 后 symlink 在 `$DSH_HOME/skills/`，`OFFICIAL_SKILLS_DIR` 跟随 `DSH_HOME`）；README / README_CN 目录树注释「untouched / 不做任何改动」改为「nexus 管理」并说明归一化与丢弃行为。两份中文验证文档全部步骤实测跑通（version-lock A/B/B2/C/D，collection [a]–[h]）。

**2026-08-26 · Fixed · 清理验证文档中已过时的硬编码测试计数**

- 4 个验证文档（`verify-version-lock.md` / `.zh-CN.md`、`verify-collection-support.md` / `.zh-CN.md`）质量门禁段仍写着硬编码用例数（version-lock 中英各写「98 个用例」、collection-support 中英各写「111 个用例」），而 2026-08-24 架构重构后实际用例数为 99，两处数值均已失效。按项目规范（验证文档不硬编码测试计数）统一改为「全部用例通过」/「expected: all tests pass」，避免每次新增测试后都要同步文档。
- 排查范围：全量复查 `test/` 9 个文件与 `docs/` 全部文档，确认无 `resolveAll` / `setEnabled` / `nexusProvider` / 旧路径 `skills-nexus/skills/` / 旧名称 `skill-bridge` 残留，DSH_HOME export/unset 12 对全部配对，测试文件导入均有使用。本次仅硬编码计数一类问题。

**2026-08-26 · Fixed · 清理 0.2.0 架构重构遗留的 5 处未使用变量 / 导入（lint 报错）**

- `npm run lint` 报 5 个 `@typescript-eslint/no-unused-vars` 错误，全部源于 2026-08-24 架构重构（Symlink + 官方 Provider）期间的重构残留，重构后未完整跑四步门禁（typecheck → lint → test → build）导致积压至今；`tsc --noEmit` 未开启 `noUnusedLocals` / `noUnusedParameters`，因此 typecheck 无法拦截，只有 lint 能发现。
- `src/cli/commands/add.ts`：删除归一化循环中未使用的 `displayName`（警告消息实际直接使用 `s.invalidName` 与 `validName`）。
- `src/cli/commands/update.ts`：删除只累加、从未读取的 `renormCount` 计数器（预期的汇总输出从未实现）。
- `src/link.ts`：删除未使用的导入 `stat`（实现全部使用 `lstat`）与 `dirname`（父目录创建简化为对 `OFFICIAL_SKILLS_DIR` 一次 `mkdir`）。
- `src/manifest.ts`：删除未使用的导入 `join`（重构后目录拼接下沉到 `paths.ts` 的 `repoDir()`）。
- 同类先例：2026-08-22 接入 CI 时曾清理过 `locator.ts` 的 `isDir`、`update.ts` 的 `findEntry` 孤儿导入——重构后应完整跑一遍门禁再提交。

**2026-08-26 · Fixed · README 本地测试 EEXIST 处理与卸载步骤修正**

- README / README_CN 的 `npm link` EEXIST 处理段落重写：新增方案 A `npm link --force`（全平台最简单）；方案 B 手动删除旧全局链接的 Git Bash 命令从硬编码 `~/AppData/Roaming/npm/...` 改为 `$(npm prefix -g)`（避免 Git Bash 中 `HOME` 环境变量配置不正确时 `~` 无法展开的问题）；新增 Windows PowerShell 段落（`Remove-Item -Force "$(npm prefix -g)\dsh-skills-nexus*"`）；移除 macOS / Linux 段落（该问题仅出现在 Windows 本地测试场景）。
- 卸载段落新增第 4 步：Windows PowerShell 删除本地测试目录 `dsh-skills-nexus` 的命令。

**2026-08-26 · Fixed · 验证文档与测试文件清理 DSH_HOME 环境变量**

- 4 个验证文档（`verify-collection-support.md` / `.zh-CN.md`、`verify-version-lock.md` / `.zh-CN.md`）的 cleanup 段只 `rm -rf` 删了临时目录但没有 `unset DSH_HOME`，跑完 walkthrough 后 `DSH_HOME` 仍指向已删除的路径，后续命令全部失效。每处 cleanup 的 `rm -rf` 后补 `unset DSH_HOME`（共 12 处：collection-support 中英各 2、version-lock 中英各 4）。
- 4 个测试文件（`add.test.ts`、`manifest.test.ts`、`update.test.ts`、`resolve.test.ts`）的 `after()` 钩子只删了临时目录但没有恢复环境变量。补 `delete process.env.DSH_HOME`。虽然 node:test 的进程隔离使跨文件不受影响，但显式清理是好习惯。

## [0.2.0] - 2026-08-24

**2026-08-26 · Fixed · Windows 下 symlink 创建报 EPERM（需要开发者模式）**

- `src/link.ts`：`linkSkill` 中 `symlink(targetDir, linkPath, 'dir')` 改为 `symlink(targetDir, linkPath, 'junction')`。Windows 上 `'dir'` 创建的是符号链接，需要开启开发者模式或管理员权限；`'junction'` 创建目录联接，不需要任何特殊权限。非 Windows 平台 Node.js 自动将 junction 回退为普通 symlink，行为不变。
- 修复了 `add` / `enable` 在 Windows 上因 `EPERM: operation not permitted` 导致 skill 无法链接到 `~/.dsh/skills/` 的问题。

**2026-08-24 · Changed · 架构重构：从「自定义 Provider」收敛为「Symlink + 官方 Provider」**

- **核心变更**：移除自定义 `nexusProvider`（`src/provider.ts` 删除），改为在 `~/.dsh/skills/` 中创建 symlink 指向 `~/.dsh/skills-nexus/repos/` 中的克隆目录。官方 filesystem provider 自动发现这些 symlink，不再需要运行时 provider 代码。
- **新增 `src/link.ts`**：symlink 管理模块（`linkSkill` / `unlinkSkill` / `isLinked` / `hasCollision`），负责在官方 skills 根目录创建/删除符号链接。
- **新增 `src/index.ts`（空实现）**：Cordis 插件入口的 `apply()` 改为空操作——仅用于 `dsh plugin add` 安装包，不再注册 provider。所有 skill 发现通过 symlink 交给官方 filesystem provider。
- **`src/paths.ts`**：新增 `OFFICIAL_SKILLS_DIR`（`~/.dsh/skills/`）和 `REPOS_DIR`（`~/.dsh/skills-nexus/repos/`），调整路径逻辑为 symlink 架构。
- **`src/frontmatter.ts`**：新增 `normalizeSkillName`（修正不合法 frontmatter name 为 kebab-case）和 `ensureDescription`（补全缺失的 description），在安装时归一化。
- **`src/git.ts`**：`sanitizeName` 修正为仅允许 `[a-z0-9]` 和 `-`（移除 `.` 和 `_` 保留），对齐官方 `SKILL_NAME` 规则。
- **`src/resolve.ts`**：`isValidSkillName` 正则修正为 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（严格 kebab-case）；`resolveAll` / `resolveByName` 删除，保留 `previewSkills` 和 `isValidSkillName`。
- **`src/types.ts`**：删除 DSH SDK 相关类型（`SkillCandidate` / `SkillDefinition` / `SkillProvider` / `NexusContext`），保留 `SkillEntry` 和 `Manifest`。
- **`src/manifest.ts`**：删除 `setEnabled` 函数（enable/disable 改为 symlink 方式，不再操作 manifest 字段）。
- **CLI 命令更新**：
  - `add`：新增 frontmatter 归一化步骤 + symlink 创建逻辑；保留 wrapped-skill y/n 确认提示。
  - `enable` / `disable`（`toggle.ts`）：重写为 symlink 创建/删除逻辑。
  - `list`：从 symlink 状态推断 enabled/disabled。
  - `update`：新增 pull 后重新归一化 + 重新创建 symlink 逻辑。
  - `remove`：处理 symlink 删除。
- **`package.json`**：版本升至 0.2.0；保留 `dsh.bundle.patch`（指向 `cordis.patch.yml`）和 `bin` 字段；移除 peerDependencies。
- **`cordis.patch.yml`**：保留，用于 `dsh plugin add` 安装。
- **README / README_CN**：更新架构图、文件系统布局（解释 `repos/` 和 symlink 两层目录）、工作原理、项目结构、本地测试步骤（保留五步流程）、卸载步骤（保留 `dsh plugin remove`）；顶部底部添加 Star 按钮和中英文切换。
- **docs/**：6 个文档文件更新，将 `resolveAll()` Node 脚本替换为 `dsh-skills-nexus list` + `ls -la ~/.dsh/skills/`；更新 provider 相关描述；修正 4 个文档文件中残留的旧路径 `skills-nexus/skills/` → `skills-nexus/repos/`（`nexus-vs-plugin.md` / `.zh-CN.md` 各 1 处，`verify-version-lock.md` / `.zh-CN.md` 各 2 处）。
- **测试**：更新 `test/git.test.ts`（`sanitizeName` 新行为）、`test/manifest.test.ts`（删除 `setEnabled` 测试）、`test/resolve.test.ts`（删除 `resolveAll` / `resolveByName` 测试，更新 `isValidSkillName` 断言）；99 个用例全部通过；`lib/` 重新编译。

**2026-08-23 · Fixed · 非法 frontmatter name 回退条目名（防止 DSH 拒绝整个 provider）**

- 实测 `CodeManYsf/cyysf-trae-skills` 的 `CurriculumDesigner` skill：frontmatter `name` 为大驼峰，DSH 报 `provider "dsh-skills-nexus" returned invalid skill name`，且**整个 provider 的所有 skill 都不可见**（移除后才恢复）。
- `resolve.ts` 新增 `isValidSkillName`（小写 kebab-case：`^[a-z0-9][a-z0-9._-]*$`）：frontmatter `name` 非法时回退条目名（与无 name 同一套回退），并记录 `invalidName` 供 `add` 警告——provider 不再返回 DSH 无法接受的名字。
- `add` 解析预览时对非法名打印 `⚠` 警告（告知实际注册名）。
- 测试 +2（`isValidSkillName` 边界、非法名回退与 `invalidName` 标记），113 个用例全部通过；`lib/` 重新编译。

**2026-08-23 · Added · 集合仓库验证文档（中英）与 README 入口**

- 新增 `docs/verify-collection-support.md` 与 `docs/verify-collection-support.zh-CN.md`：集合仓库支持（P1）的端到端验证流程，Windows（Git Bash）/ Linux / macOS 各一份可整体复制的命令块，覆盖质量门禁（111 用例）、全量拒绝 + `--subdir` 提示、按子目录独立克隆安装、SUBDIR 列、按条目 enable/disable、remove 隔离、大集合防呆、平铺 md 身份规则（无 frontmatter 平铺 md ≠ skill），并收录踩过的坑（DSH_HOME 累积、交互确认、subdir 校验、平台路径、git 版本）与覆盖边界。
- README / README_CN「开发：测试与 CI」入口链接改为双文档（版本锁定 P0 + 集合仓库 P1）。

**2026-08-23 · Added · 集合仓库支持（--subdir）与平铺扫描保守化**

- **平铺扫描保守化（修"假装安装"）**：locator 跳过名单改为前缀模式（`readme*` / `contributing*` / `changelog*` / `license*` / `code-of-conduct*` / `code_of_conduct*` / `security*`），`README.zh-CN.md` 等变体不再被当作 skill 候选；平铺 `*.md` 没有 frontmatter `name` 且没有 `description` 的不再成为 skill（resolve 阶段过滤）——集合仓库根目录的文档文件（`community-leaderboard.md` 等）永远不会被"假装安装"。
- **add 解析预览**：注册前按完整 skill 规则解析预览，结果为 0 时拒绝安装并提示嵌套子目录可用 `--subdir`；unknown 分支同样检测嵌套并提示（修掉 Observed 记录中的空条目隐患）。
- **新增 `--subdir <path>`**：只把克隆内某个子目录当作 skill 根安装（**独立克隆设计，v1**；P1/P2 命令对比与隐藏坑见 [docs/subdir-design.md](docs/subdir-design.md)）。条目新增 `subdir` 字段（向后兼容），name 默认取子目录末段（`--name` 可覆盖），path 按 `repo-subdir` 唯一化；resolve 按 `subdir` 拼接解析根；`list` 新增 SUBDIR 列。
- **大集合防呆**：一次安装解析出超过 20 个 skill 时弹确认提示（`--yes` 跳过，非 TTY 默认拒绝）；显式 `--subdir` 安装跳过该提示。
- **测试**：新增集合仓库用例（`--subdir` 安装 / 缺失路径 / 非法值 / 嵌套拒绝 / 大集合确认）、locator 文档变体、resolve 平铺过滤与 subdir 拼接、repo-kind `markerDir` 用例——111 个用例全部通过。
- 同步更新 README / README_CN、verify-version-lock 中英（新增「集合仓库」验证节）、CHANGELOG 与编译产物 `lib/`。

**2026-08-23 · Observed · 嵌套集合仓库会被"假装安装"（集合仓库支持功能的动机）**

- 现象：对 `skills/<name>/SKILL.md` 布局的**集合仓库**（实测 `trae-community/trae-skills`，12 个 skill）执行 `add` 会注册"成功"（exit 0），但实际装入的是仓库根目录的文档型 md：`README.zh-CN.md`、`CONTRIBUTING.md`、`CONTRIBUTING.zh-CN.md`、`community-leaderboard.md`——全部因无 frontmatter 而回退为 entry 名；`skills/` 下的 12 个真 skill 一个都没有被发现。比直接拒绝更隐蔽：用户会误以为装好了。
- 根因：`locator.ts` 的单层子目录规则（`<root>/<name>/SKILL.md`）够不到 `skills/` 前缀的两层嵌套；平铺规则（规则 3）把根目录所有非精确 `readme.md` / `changelog.md` / `license.md` 的 `.md` 文件都当作 skill 候选，跳过名单不做模式匹配（`README.zh-CN.md` 等变体漏网）。
- 复现命令（2026-08-23 实测）：
  ```bash
  git clone --depth 1 https://github.com/trae-community/trae-skills /tmp/trae-skills
  ls /tmp/trae-skills | head -30                       # 根含 skills/ 分类目录
  find /tmp/trae-skills -maxdepth 2 -name SKILL.md | wc -l   # → 0
  find /tmp/trae-skills -maxdepth 3 -name SKILL.md | wc -l   # → 12（两层嵌套）
  export DSH_HOME="$(cygpath -m "$TEMP/nexus-trae-demo")"
  node lib/cli/index.js add "C:/Users/asswsw/AppData/Local/Temp/trae-skills"  # → exit 0
  node -e "import('./lib/resolve.js').then(async m => { (await m.resolveAll()).forEach(s => console.log(s.name + '  <-  ' + s.skillFile)) })"
  # → 仅 4 个文档文件被解析为 skill（name 全部回退 trae-skills）
  ```
- 结论：集合仓库当前不可用且不可控。作为「集合仓库支持」功能（`--subdir` 子路径选择 + 平铺扫描保守化）的动机记录，列入下一迭代计划（P1）。

**2026-08-23 · Added · 版本锁定验证文档（中英）与 README 入口**

- 新增 `docs/verify-version-lock.md` 与 `docs/verify-version-lock.zh-CN.md`：版本锁定（P0）的端到端验证流程，Windows（Git Bash）/ Linux / macOS 各一份可直接复制的命令块，覆盖测试套件、分支快进、tag 固定点、漂移自愈、重复 add 保护与 manifest 锁检查，并收录实践中踩过的坑（浅克隆 checkout、注册名来源、残留 DSH_HOME、路径格式、git 版本等）与覆盖边界。
- README / README_CN「开发：测试与 CI」小节加入口链接。

**2026-08-23 · Added · 版本锁定（lockfile-lite）与 pinned 更新的语义修正**

- `SkillEntry` 新增 `commit` 字段：`add` 克隆成功后记录实际解析到的 commit SHA（`git rev-parse HEAD`），manifest 成为轻量锁文件；`list` 新增 COMMIT 列显示安装版本的短 SHA。
- `update` 按 pin 类型分派：分支 pin → `git pull --ff-only`，打印 commit 变化（`A → B`）并重新盖章 `commit`；tag / commit pin（detached HEAD）→ 不再执行 pull（修复此前 `git pull` 在 detached HEAD 上必然失败的问题），改为校验本地 HEAD 是否仍等于 pin 的 commit，漂移时自动恢复。
- 旧 manifest 无需迁移：缺失 `commit` 时 `list` 显示 `—`，首次成功 `update` 后自动补齐。
- 新增测试：`git.test.ts` 增加本地仓库用例（`getHeadCommit` / `isDetachedHead` / `resolveRefCommit` / `checkoutRef`、clone 分支 vs tag 的 HEAD 形态）；新增 `test/update.test.ts` 用本地 `file://` 远端覆盖「分支快进」「tag 固定点」「漂移恢复」三条路径；`manifest.test.ts` 覆盖 `markUpdated` 盖章 commit。
- 修复 `add` 对已注册仓库重复添加时的破坏性清理：重复注册检查提前到 clone 之前（此前 clone 因目录已存在而失败时，失败清理会误删已注册 skill 的克隆目录）。新增 `test/add.test.ts` 覆盖「注册记录 commit」与「重复添加拒绝且克隆完好」。
- 同步更新 README / README_CN（Usage 注释与注意事项）与编译产物 `lib/`。

**2026-08-23 · Changed · docs：Quick flow 流程图改为 Mermaid**

- 将 `docs/nexus-vs-plugin.md` 与 `docs/nexus-vs-plugin.zh-CN.md` 中 Quick flow / 快速流程图 的 ASCII 树形图替换为 `flowchart LR` 的 Mermaid 图，横向展开避免纵向过长。
- 配色与 README 架构图一致（`classDef` 统一声明：灰=起点、琥珀=判断、绿=分类、蓝=命令、粉=终止），中英文两版保持同一结构。

**2026-08-22 · Added · 接入 CI、单元测试与 lint，补齐 nexus vs plugin 决策文档**

- 新增 GitHub Actions CI（`.github/workflows/ci.yml`）：push / PR 时在 Node 18/20/22 上依次跑 `typecheck` → `lint` → `test` → `build`，并校验已提交的 `lib/` 与最新源码一致（防止发布包与源码漂移）。
- 新增 ESLint 9 + typescript-eslint（flat config，`eslint.config.js`），`npm run lint` / `npm run lint:fix`；顺手删除了 `locator.ts` 中未使用的 `isDir`、`update.ts` 中未使用的 `findEntry` 导入。
- 新增单元测试（`node:test` + tsx，无额外测试框架），共 86 个用例，覆盖：`git.ts`（parseGitSpec 全部仓库格式 / repoSlug / sanitizeName）、`frontmatter.ts`（坏 YAML、块标量、CRLF、flag）、`locator.ts`（三种发现布局、跳过文件、隐藏目录）、`repo-kind.ts`（四种仓库分类）、`cli/args.ts`、`manifest.ts`（临时 DSH_HOME 读写往返、损坏文件备份）、`resolve.ts`（多 skill、开关、名称回退）。
- 新增 `tsconfig.test.json` + `npm run test:build`：把 src + test 编译到 `test-dist/`，可在无 tsx loader 的环境直接 `node --test` 运行。
- 新增 `docs/nexus-vs-plugin.md` 与 `docs/nexus-vs-plugin.zh-CN.md`：用仓库内容分类讲清「什么情况用 nexus、什么情况用 dsh plugin」，含决策表、流程图、示例与 FAQ；README / README_CN 顶部加入口链接与 CI 徽章。

**2026-08-22 · Added · add 命令增加仓库类型识别与确认提示**

- 新增 `src/repo-kind.ts`，在 `add` 注册前对克隆仓库进行分类：纯 SKILL.md 仓库、SKILL.md + DSH 薄包装层、纯 DSH 插件、无法识别仓库。
- 对「SKILL.md + DSH 薄包装层」仓库，`add` 会询问是否忽略包装层并按 nexus 管理；输入 `y` 继续，输入 `n` 中止并提示改用 `dsh plugin add`。
- 对「纯 DSH 插件」仓库，直接提示请按该仓库自己的 DSH 插件安装方式使用，不注册并退出。
- 对「两者都不是」的仓库，报错退出。
- 新增 `--yes` / `-y` / `--force` 参数，可跳过薄包装层确认提示；非交互环境下默认不继续，避免自动化挂起。
- 同步更新 README 与编译产物 `lib/`。

**2026-08-22 · Changed · 项目改名 dsh-skill-bridge → dsh-skills-nexus**

- GitHub 上已有同名项目 `dsh-skills-hub`（by lcthe），且 `dsh-skills-bridge` 也已有类似项目，为避免混淆改名。
- `nexus` = 枢纽/连接中心，贴合项目定位：一个 provider 承载多个 skill，是所有外部 skill 进入 DSH 的中心节点。
- 全局替换：包名、CLI 命令名、插件 ID、provider 变量名（`bridgeProvider` → `nexusProvider`）、上下文类型（`BridgeContext` → `NexusContext`）、本地存储目录（`~/.dsh/skill-bridge/` → `~/.dsh/skills-nexus/`）、环境变量（`DSH_SKILL_BRIDGE_HOME` → `DSH_SKILLS_NEXUS_HOME`）。
- 项目文件夹同步从 `dsh-skill-bridge/` 重命名为 `dsh-skills-nexus/`。

**2026-08-22 · Fixed · 修正本地测试第五步说明**

- 原文仅写「回到 DSH 会话问一句」，未说明第三步启动的 DSH 进程在第四步加 skill 之前就已运行，直接在原界面提问看不到新 skill。
- 补充明确说明：必须回到第三步的终端，`Ctrl+C` 停掉 DSH 进程，重新执行 `npx @deepseek-ai/dsh web --patch overlay.yml`，让 provider 重新加载后 `list()` 才会扫描到新 skill。

**2026-08-22 · Fixed · 修正 overlay.yml 中 Windows 路径格式说明**

- Node.js ESM loader 在 Windows 上将裸 `C:/...` 路径中的 `C:` 解释为 URL 协议，导致 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 错误。
- 修正两个 README 中的 overlay.yml 路径说明：Windows **必须**在盘符前加 `/`（即 `/C:/...`），对应的一键生成命令从 `'$(pwd -W)/lib/index.js'` 改为 `'/$(pwd -W)/lib/index.js'`。
- YAML 注释中 macOS / Linux 路径示例拆分为独立两行（`# macOS:` / `# Linux:`），不再合并写为 `# macOS / Linux:`。

**2026-08-22 · Changed · README 结构重构**

- 删除独立的「构建」章节：终端用户通过 `dsh plugin add` 安装时直接使用仓库内已提交的 `lib/`，无需手动 build。
- `npm run typecheck` 从独立章节移至「本地测试步骤」第一步内，作为可选提示。
- 「工作原理」从「使用」和「文件系统布局」之间移至「发布」之后、「注意事项」之前，与「项目结构」相邻——开发者视角的内容靠后，用户流程优先。
- 安装章节补充说明：「`lib/` 编译产物已随仓库提交，安装即用」。
- GitHub 用户名占位符 `<你>` / `<you>` 全部替换为 `xiaxi626`。

**2026-08-22 · Added · 新增 CHANGELOG**

- 新增 `CHANGELOG.md`，遵循 Keep a Changelog 1.1.0 + SemVer 规范，中文编写。
- 记录 0.1.0 版本的全部新增与修复内容。

**2026-08-22 · Added · package.json 新增 repository / homepage / bugs 字段**

- 指向 `https://github.com/xiaxi626/dsh-skills-nexus`。
- 不使用 `prepare` 脚本——编译产物 `lib/` 直接随仓库提交，安装即用，不依赖用户环境的 TypeScript 工具链，也避免 npm / pnpm 行为差异。

**2026-08-22 · Added · 新增 README_CN.md**

- 完整中文版 README，与英文版内容同步。

## [0.1.0] - 2026-08-22

**2026-08-22 · Fixed · clone 失败时自动清理半成品目录**

- 此前 `git clone` 失败会留下空目录或不完整目录，导致重试时可能被目录存在干扰。
- 改为 `try/catch` 包裹 clone 操作，失败时 `rm -rf` 清理目标目录，保证重试干净。

**2026-08-22 · Fixed · 默认分支从硬编码 main 改为自动探测**

- `add` 命令未指定 `#ref` 时，通过 `git ls-remote --symref` 查询远程 HEAD 符号引用，自动识别 `master` / `main` 等默认分支名。
- 修复了默认分支不是 `main` 的仓库（如 `xiaxi626/theme-port-skill`）clone 失败的问题。
- 用户仍可通过 `#branch` / `#tag` / `#commit-sha` 显式指定引用。

**2026-08-22 · Added · 项目配置与文档**

- 新增 `package.json`：声明 `dsh.bundle.patch`，指向 `cordis.patch.yml`，可被 `dsh plugin add` 作为插件安装。
- 新增 `cordis.patch.yml`：Cordis bundle patch layer 注册文件。
- 新增 `tsconfig.json`：TypeScript 编译配置（NodeNext 模块、严格模式、输出到 `lib/`）。
- 新增 `.gitignore`：排除 `node_modules/`、`lib/`、`overlay.yml`、`test-provider.mjs` 等本地开发文件。
- 新增 `README.md`：包含安装、使用、工作原理、SKILL.md 发现规则、文件系统布局、项目结构、构建、卸载、本地测试步骤、更轻的验证方式、发布方式、注意事项。
- 本地测试文档覆盖五步流程（编译 → overlay → 启动 DSH → CLI 加 skill → DSH 内验证），并提示移动项目文件夹会导致 `npm link` 报 EEXIST 及处理方法。

**2026-08-22 · Added · CLI 命令（add / list / update / remove / enable / disable）**

- 新增 `src/cli/index.ts`：命令分发器，支持 `add` / `list` / `update` / `remove` / `enable` / `disable` 六个子命令（含别名 `ls` / `rm` / `pull`）。
- 新增 `src/cli/args.ts`：轻量 argv 解析，支持 `--name` / `--ref` 选项。
- 新增 `dsh-skills-nexus add`：克隆 GitHub 仓库到 `~/.dsh/skills-nexus/skills/<name>/` 并写入 manifest；自动探测默认分支；clone 失败时清理半成品目录。
- 新增 `dsh-skills-nexus list`：列出所有已注册 skill 及其状态（启用/禁用、ref、目录是否存在、更新时间）。
- 新增 `dsh-skills-nexus update`：对指定或全部已启用 skill 执行 `git pull --ff-only`，成功后更新 `updatedAt`。
- 新增 `dsh-skills-nexus remove`：删除 clone 目录并从 manifest 注销。
- 新增 `dsh-skills-nexus enable / disable`：切换 skill 的目录可见性，不删除文件。
- `package.json` 声明 `bin` 字段，`npm link` 后可全局使用 `dsh-skills-nexus` 命令。

**2026-08-22 · Added · 项目初始化：DSH 通用 skill 枢纽插件**

- 新增 `src/index.ts`：Cordis 插件入口，通过 `ctx.skills.registerProvider()` 注册 `nexusProvider`，采用薄包装层模式。
- 新增 `src/provider.ts`：`nexusProvider` 实现 `list()` / `get()` 两个方法，单个 provider 承载多个 skill；`resourceBase` 按 skill 指向各自的 clone 目录，使 `references/`、`scripts/`、`assets/` 相对路径可被模型正确解析。
- 新增 `src/resolve.ts`：读取 manifest → 定位 SKILL.md → 解析 frontmatter → 组装 `SkillCandidate` / `SkillDefinition`。
- 新增 `src/manifest.ts`：manifest.json 的读写、查找、增删、启用/禁用，作为 CLI 与 provider 之间的状态后端。
- 新增 `src/locator.ts`：在克隆仓库内按优先级发现 SKILL.md（根目录 `SKILL.md` → `<name>/SKILL.md` 子目录 bundle → 扁平 `<name>.md`），与官方 `dsh-skill-filesystem` 发现规则对齐。
- 新增 `src/frontmatter.ts`：基于 `yaml` 包的 frontmatter 解析，支持 block scalar（`>` / `|`），识别 `name`、`description`、`disable-model-invocation`、`user-invocable` 字段。
- 新增 `src/git.ts`：`parseGitSpec()` 支持 `github:`、`https://`、`git+https://`、`git@`、`owner/repo` 简写等多种输入形式；`cloneRepo()` 浅克隆，支持分支/tag/commit SHA；`getDefaultBranch()` 通过 `git ls-remote --symref` 自动探测远程默认分支（回落到 `main`）。
- 新增 `src/paths.ts`：`DSH_HOME` / `DSH_SKILLS_NEXUS_HOME` / `SKILLS_DIR` / `MANIFEST_PATH` 路径常量，支持环境变量覆盖。
- 新增 `src/types.ts`：`Manifest` / `SkillEntry` / `SkillCandidate` / `SkillDefinition` / `SkillProvider` / `NexusContext` 结构类型，项目在没有 `@deepseek-ai/dsh-skill` 时也能通过类型检查。
