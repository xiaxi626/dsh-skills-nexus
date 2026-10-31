# 面板列表加载与操作反应提速设计

> **中文** | [English](perf-panel-list-loading.md)

状态：为后续实施划定设计边界，不是实施报告或验证报告。目前没有任何计时测量数据。下文 P1、P2、P3 指本文档定义的扫描、客户端与测量三个阶段。

目标是减少重复的文件系统开销、避免面板冗余的列表请求，同时不改变链接归属、列表输出与组状态语义。架构上下文见[架构总览](ARCHITECTURE.zh-CN.md)，贡献约定见[贡献指南](../CONTRIBUTING.zh-CN.md)。以下要求自包含，优先于源码注释中出现的任何历史简写。

## 一、瓶颈核对

### 当前读取路径

- `src/manifest.ts` 读取一次 manifest，然后对每个 entry 调用 `entryLinks`。在 `src/link.ts` 中，每次调用都会规范化 entry 的 base、枚举 official skills 根目录、并对每个候选 target 做解析与规范化。
- `src/http/routes.ts` 在这些链接上叠加装饰：先对 target 做 `stat`，再经 `linkSkillName` → `previewSkills` 读取 frontmatter 名称。正常的根目录布局需要一个位于根部的 `SKILL.md` 定位 `stat` 加一次 `readFile`。
- `src/update-cache.ts` 的 `getUpdateStatus` 是纯内存查表，不读文件、不接触 git，不构成文件系统瓶颈。

设 \(N\) 为 manifest entry 数、\(L\) 为 skills 根目录中的条目名数。下表是**应用层 FS API 调用量估算**，前提是未改动的、一切正常的成功路径夹具：每个 target 根部有 `SKILL.md`，每个链接恰好归属一个 entry，所有路径解析首次即成功。这些不是 OS 系统调用数，也不是实测加速比。

| 边界 | 现状完整模型 | 仅 P1 之后 | \(N=10, L=50\) |
|---|---|---|---|
| T1：`listEntries` | \(1+2N+2NL\) | \(N+2+2L\) | 1021 → 112 |
| HTTP 装饰（T1 之外） | \(3L\) | \(3L\) | 150 → 150 |
| T2：完整 list 路由 | \(1+2N+2NL+3L\) | \(N+2+5L\) | 1171 → 262 |

T1 现状为每个 entry 各计一次 manifest 读取、一次 base 解析、一次根目录枚举，外加每个 entry/链接对两次解析调用。P1 之后保留 manifest 读取，每个 base 只规范化一次，根目录只枚举一次，每个链接只解析并规范化一次。T2 额外包含 target 存在性检查与 frontmatter 读取；`deriveGroupStates` 只增加计算量、不增加 FS 调用。

舍弃固定项与 \(N\) 级小项后得到标题口径：\(2NL+3L=1150\) → \(5L=250\)，仅 P1 之后估算 FS API 调用量约减少 **78%**。完整模型口径的降幅同样约为 78%；两种推算都不构成墙钟时间提升的结论。

`safeRealPath` 的失败恢复在向上遍历祖先目录时（包括对失败路径的重试）可能发出额外 `realpath` 调用。悬空链接、多归属桶、非根目录发现布局都会改变调用计数。P1 之后仍要在内存中把每个已解析 target 与所有 base 逐一比对：比对这些仍是 \(O(NL)\)。被归并的只是重复的 FS 扫描，整个算法不得描述为 \(O(L)\)。

## 二、P1 —— 归并链接扫描器，不改变归属

### 接口与五条等价性条件

扫描器落在 `src/link.ts` 中 `entryLinks` 的旁边，不新建模块，共用 `pointsInto`、`safeRealPath` 与 `readLinkEntryTarget`：

```ts
export async function scanEntryLinks(entries: SkillEntry[]): Promise<Map<string, EntryLink[]>>
```

Map 以 entry 的管理名为键；每个入参 entry 若无匹配则对应空数组。manifest 名称唯一性的既有约定保持不变。

1. **每个 entry 一次规范化 base。** 对每个 entry 计算 `entrySkillDir(entry)` 并调用一次 `safeRealPath`，并发有界。保留既有外部目录与管理子目录规则，包括 legacy external entry；不得用猜测的 clone 路径替代。
2. **根目录只枚举一次。** `readdir(OFFICIAL_SKILLS_DIR)` 只调一次。任何失败（含 skills 根目录缺失）使所有入参 entry 得到空数组，与现状逐 entry 扫描的行为逐位一致。
3. **每个根条目名一次 target 读取。** 每个名字调用一次 `readLinkEntryTarget`，保留其 POSIX 悬空 symlink 的 `readlink` 回退；返回 `undefined` 时跳过、不猜测归属。工作池并发上限为常量 **8**，且该上限同时约束 base 预处理，不是所有 entry 或所有链接一次性铺开。
4. **每个成功解析的 target 一次规范化，收录进所有命中桶。** 对每个取回的 target 调用一次 `safeRealPath`，再用 `pointsInto` 与**所有** base 比对，收集全部命中。一个链接可以同时归属父 entry 与嵌套 subdir entry；首个命中即分桶是错误实现。
5. **保持原始枚举顺序与 target 表示。** 每个桶必须保持 `readdir` 的原始返回顺序，不是 worker 完成顺序，也不引入新的排序。按索引写入结果、按枚举顺序组装。`EntryLink.target` 仍是规范化后的字符串，`list --json` 契约不变。

这些是归属规则，不是新增的链接类型过滤器。不得因为真实目录不是 symlink 就把它们排除：既有读取器会解析它们，是否收录由既有的 base 谓词决定。target 不可恢复的 Windows 悬空 junction 保持无归属——名字本身或假定的 clone 关系都不是归属证明。不得为了扫描更快而改动移除与冲突保护语义。

### 接线边界

- `entryLinks` 改为 `scanEntryLinks` 的单 entry 薄包装。toggle、remove、update、adopt 调用方零改动，保持原有单 entry 调用与写路径行为。
- `src/manifest.ts` 对全部 manifest entry 调用一次扫描器，再按 manifest 顺序组装输出。`enabled` 从各桶推导，`getUpdateStatus(entry.name) ?? null` 保留在输出组装处。
- `src/cli/commands/list.ts` 默认表格路径把逐个 `isEntryEnabled` 替换为对所选 entry 的一次扫描。保留独立的 `present` `stat`、过滤、列与输出顺序。`--names` 保持仅读 manifest、不做扫描的路径，含既有的空结果/过滤行为。
- `list --json` 的 schema、规范化 target、数组顺序与框架保持不变。HTTP 路由继续装饰共享的列表视图；P1 不静默引入 P3 的装饰候选。

### 差分测试矩阵

P1 实施时新建 `test/link-scan.test.ts` 并注册进 `package.json` 的显式 `test` 脚本清单——只建文件不等于注册。核心裁判是**改动前的逐 entry 实现**，它以独立测试参照的形式保留。在同一份未改动夹具上，用 `deepStrictEqual` 对每个旧逐 entry 结果与对应的新 Map 桶逐项比较，含顺序与 target 字符串。把新包装与自己的批量扫描器互比属于自我比较，不能证明等价。

| 夹具 | 必证内容 |
|---|---|
| 存活的 managed、external、subdir target | base、名称、规范化 target 与 enabled 状态逐位一致 |
| 悬空 POSIX symlink | 经 `readlink` 恢复已删除 target；可归属链接保持收录 |
| 悬空 Windows junction | 保持读取器在该平台的真实结果；不可读则跳过，不得虚构归属 |
| skills 根内的真实目录 | 与旧谓词结果一致；冲突与移除保护不变 |
| 嵌套的 parent 与 subdir base | 同一链接同时出现在两个命中桶 |
| clone 目录缺失 | 保持祖先规范化行为，以及可恢复悬空 target 的归属 |
| skills 根缺失或不可读 | 每个 entry 都得到空数组 |
| 祖先被 `realpath` 重写 | 复用 `test/link-canonical.test.ts` 的目录链接手法，并断言重写确实发生 |
| worker 乱序完成 | 桶仍按原始枚举顺序；观测到的并发不超过 8 |

夹具的 home 环境变量必须在导入路径依赖模块图之前设置，临时目录必须清理。平台限制必须显式说明；一个连自身前置条件都无法建立的夹具，不构成该用例通过的证据。

P1 要求差分套件与四个回归护栏全部通过：`test/link.test.ts`、`test/link-canonical.test.ts`、`test/list.test.ts`（含 `--json` 输出不变断言）、`test/cli-plugin-parity.test.ts`。验收证据缺一不可。

## 三、P2 —— 面板快照补全与轮询提前退避

### 对账契约

`src/client/api.ts` 的 `reconcileList` 现在只返回 entries，面板因此要在成功收尾额外发一次 `api.list()` 修复组状态。规划中的内部返回结构保留同一份 list 响应的两个字段：

```ts
type ReconcileResult = { entries: ListEntry[]; groupStates: GroupState[] }
```

复用 list 响应既有的 `ListEntry` 与 `GroupState` 定义，不另造字段含义不同的第二套形状。

- `reconcileList` 返回 `Promise<ReconcileResult>`，每次未满足的轮询都把完整结果传给 `onTick`，保持回调时机不变。
- `ReconcileTimeoutError` 携带最后一次响应的 `entries` 与 `groupStates`。`until` 保持是仅针对 entries 的谓词；不加强变异完成语义，不改既有的对账间隔与超时预算。
- 面板 `reconcileAfter` 中，tick、成功、超时三条路径都从对应快照同时更新 entries 与 group states，保留既有的 mounted 状态守卫与提示。为兼容较旧的响应，group states 缺失时保留空数组回退。
- 成功收尾的 `api.list()` 只有在全快照接线完成之后才移除。`done` 与 `unsupported` 仍走 `refresh`；unsupported-host 的说明文案保留。hotReload 字段缺失仍按 pending 路径处理。

`reconcileList` 与 `ReconcileTimeoutError` 未经 `src/client/index.tsx` 再导出。这是仓库内部 API 变更，不构成对包的公开 client 入口或 HTTP list 响应的 breaking change。

### 轮询节奏

`pollJob` 参数面不变。首次请求仍在 \(t_0\)；若任务仍在运行，后续 sleep 依次为 **200ms、400ms，此后稳定回到 `intervalMs`**。面板 `track` 当前传入 **800ms**，helper 默认值是 **1000ms**——两者是不同的稳态值，不得混同。不得拖延已经得出结果的首次响应，也不改变任务的取消、错误与超时语义。

### 必证内容

- 更新 `test/client-api.test.ts` 适配新的返回/回调签名，覆盖完整的成功与 tick 快照，以及带两个字段的超时快照。排队响应必须建模组状态变化，不能只有 entries。
- 用计数 mock API 或交互台架驱动面板真实的对账编排。一次 pending toggle 需要 \(k\) 次列表轮询时，断言变异相关列表调用恰为 \(k\) 次而非 \(k+1\) 次；挂载时的初始 refresh 单独计账。断言 tick、最终成功、超时三条路径的组状态同步更新，以及 `done`/`unsupported` 的 refresh 行为不变。
- `test/panel-render.test.tsx` 保持静态渲染守卫的定位。它的 SSR 渲染器不跑 effect，无法证明点击、轮询与请求计数。验收需要真实的编排 mock 或交互证据，不能把 SSR 断言改个名字充当交互测试。`test/group-states.test.ts` 继续负责服务端组推导语义。
- 注入 `sleep` 断言长作业序列：面板配置下为 200/400/800/800…，helper 默认下为 200/400/1000/1000…。同时检查首次即完成的路径与既有的超时/取消行为。

## 四、P3 —— 先测量，再做装饰决策

### 可复现的测量边界

使用一次性脚本，不进仓库历史。在动态 import 应用模块**之前**同时设置 `DSH_HOME` 与 `DSH_SKILLS_NEXUS_HOME`：`src/paths.ts` 在 import 时取值，静态 import 之后再切换变量不会迁移已加载的模块图。

1. 建立一次性夹具：10 个 entry、约 50 个链接，用 `symlink(target, linkPath, 'junction')` 指向真实存在的目标目录。每个正常 target 根部放 `SKILL.md`；断言根目录实际条目数/链接数与 target 解析结果，不能假设循环造出了 50 个可用链接。
2. 分别测量 **T1 = `listEntries`** 与 **T2 = 完整 `listRoute` 路径**——经由注册的 list handler，含链接装饰与 `deriveGroupStates`。只测扫描器或只测装饰器都不是 T2。
3. 每个前后对比边界都要 **3 次 warmup 加至少 20 次采样**；报告中位数与 p95，附样本量、夹具规模、运行时/平台与测量范围。夹具与计时边界保持可比。
4. 归因用 `--cpu-prof` 统计相关采样帧，与墙钟计时分开报告。采样帧不是精确的 FS 调用计数器。不要在应用 import 之后给 `fs/promises` 打补丁并假定具名 import 会被拦截——具名 import 在加载时已绑定。

真实 `~/.dsh` 环境单独测量且**只读**。合成 junction 结果不能替代真实 target 布局，也不能替代 Windows Defender 对 `realpath` 延迟的可能放大。真实与合成两组数据分开报告，包括各自不同的规模与布局。

存在一个具体的只读隐患：`readManifest` 在 JSON 解析失败时会写入 `.corrupt-…` 备份。调用真实目录的 list 路径前，必须先确认 manifest 有效或不存在、该备份写入路径不会被触发。无法保证时停止真实目录测量并如实报告限制。本设计不授权修复 manifest，也不授权向真实 home 写入任何内容。临时脚本与性能剖面文件放在真实 home 之外。

若沙箱限制导致无法 spawn 测量进程，按用户指示改用本地终端执行。被阻止或不可得的测量要如实报告；不得编造数字，不得用调用计数模型冒充计时结果。用完删除临时脚本、夹具与剖面文件，不提交。

### 候选评估

只有当实测归因指向显著残留瓶颈、且随后有语义差分证据时，才允许实施下列 P3 候选：

| 候选 | 必须保持的约束与对照 |
|---|---|
| target `stat` 失败后跳过 preview | 保留悬空链接上报与现有链接名回退；证明失败路径行为等价 |
| 装饰复用 P1 target | 消费已规范化的 target；装饰期不再二次解析链接 |
| 单次请求内按物理 target 去重名称计算 | 共享已解析名称或缺名结果，绝不共享某个别名自己的最终回退；每个别名的回退各自独立应用 |
| 装饰并发上限 | 用常量池上限 8 替代嵌套的无上限 FS 并发；保持 entry 与链接顺序 |
| 单文件 locator/名称路径 | 先读 `src/locator.ts` 与 `src/resolve.ts`；对照既有路径的发现优先级、首技能选取、非法/空名称、不可读文件与回退行为 |

`locateSkillFiles` **已经**对根部 `SKILL.md` 做 `stat` 并在它是文件时早退。任何提案不得声称该快速路径不存在。每次 list 请求仍要读取当前 frontmatter 真值；常驻或跨请求的名称缓存不能替代这一点。对根部有文件的正常独立 target，定位 `stat` 加 `readFile` 约 \(2L\) 次调用是该契约下名称读取的下限，**不是整条路由的下限**。

收益不足时，把每个候选只登记不实施是合法结论。后续 P3 的实测记录与 P1 验证补记必须包含真实的 T1/T2 前后中位数与 p95、归因、以及每个候选的处置结论。它们是未来证据，不是本次文档步骤要补齐的产物——目前没有可填的测量数据。

## 五、已知不做 —— 三档处置登记

P1 的归并扫描与 P2 的全快照/早期退避是已选定设计。下表把有条件的后续工作与已被否决的替代方案区分开；不是每个邻近机会都属于实施范围。

### 有条件的 P3 顺带项

| 项目 | 为什么不自动做 | 启动或重启条件 |
|---|---|---|
| failed-stat 跳过 preview | 可能只省错误路径成本，且会改变回退行为 | 显著实测归因 + 失败路径语义对照通过 |
| 装饰复用 P1 target | 重复解析须被证明、不能假定 | 冗余工作的证据 + 规范化 target 行为不变 |
| 请求内物理 target 名称去重 | 独立 target 无收益；别名各有回退 | 重复 target 成本实测 + 别名/回退差分覆盖 |
| 装饰池上限 8 | 调度改变未必在每个文件系统上降低延迟 | 显著归因成本 + 有界性与顺序证据 |
| 单文件 locator/名称路径 | 根部文件早退已存在；复制发现规则有风险 | 剩余发现成本实测 + 布局/名称差分测试通过 |

这些是 P3 候选清单，不是在做 P1 或 P2 时顺带实施它们的许可。

### 独立提交项

| 项目 | 独立成提交的原因 | 执行或重启条件 |
|---|---|---|
| `checkUpdates` 远端检查 | 网络 `ls-remote` 并发与本地列表 FS 开销是两回事 | 已列入计划的独立步骤：池上限 3–5，保持 manifest 结果顺序，注入执行器同时测并发上界与顺序。不为其新增按候选授权或独立测量前提 |
| CLI 命令按需 import | 启动模块加载与热列表路由延迟是两回事 | 空 manifest 下 `node lib/cli/index.js list` 前后各至少 20 次冷启动对比；收益不显著则跳过并登记。当冷启动证据显示实质性的命令加载成本时重启 |

当前 dispatcher 的 import 是 **15 个命令模块 + 1 个 usage 模块 = 16**；加上独立的 `cliIO` import，顶层总数为 **17**。这不是 16 个命令模块。懒加载实施落在 dispatcher——按需加载命令模块；不得扩大成 `cliIO` 重构。远端检查步骤仍按计划保留独立的测试与提交，不是未经批准的新优化请求。下文常规阶段门禁与交接规则对两项同样适用。

### 否决的替代方案

| 替代方案 | 否决理由 | 重启条件 |
|---|---|---|
| 去掉规范化 | 祖先路径被重写时破坏归属判定 | 新的显式路径/归属契约 + 单独批准 |
| 去掉悬空 target 回退 | 丢失可恢复的 POSIX target，归属与清理都会受损 | 新的显式悬空链接契约 + 单独批准 |
| 首个命中桶即分区 | 改变 parent/subdir 重叠语义 | 新的显式归属一致性契约 + 单独批准 |
| 移除 CLI `present` `stat` | 链接归属不能证明目录在场 | 新的显式列表状态契约 + 单独批准 |
| 未传全快照就删组状态补偿 | 重新引入陈旧组开关与条目/组不一致 | 新的显式快照一致性契约 + 单独批准；P2 的做法是先补全数据再删请求 |
| 无上限 FS 或 git 并发 | 把重复开销换成不可控的资源压力 | 新的显式资源/并发契约 + 单独批准 |
| 缓存名称、不再每请求读 frontmatter | 用陈旧显示态取代磁盘真值 | 新的显式新鲜度/失效契约 + 单独批准 |

以上重启条件不隐含任何与本方案无关的优化需求。

## 六、验收、产物与阶段交接

### 后续实施阶段的验证

每个实施阶段推进前，`npm run typecheck`、`npm run lint`、`npm test` 必须全部通过。失败、平台跳过与警告如实记录。格式检查通过或估算调用量下降都不构成性能结果。

- **P1：** 要求新旧逐 entry 差分等价、扫描器五条等价性条件、并发/顺序证据、四个具名护栏全部通过。新测试文件须注册进显式脚本清单，临时目录须清理。
- **P2：** 要求 tick/成功/超时三条路径的全快照、面板真实请求计数、注入 `sleep` 的序列断言。静态渲染只是补充证据，不能替代编排或交互覆盖。
- **P3：** 要求实测 T1/T2 中位数/p95 与候选处置结论；真实 home 数据与合成数据分开。只有实测证据支持提速主张；不可得的真实数据须标注不可得。
- **独立步骤：** 保留远端检查的执行器上界/顺序测试与上文所述 CLI 冷启动对比；新增测试文件一律注册进显式清单。

任何 `src` 改动（含仅注释改动）都要求 `npm run build`，并把对应的重建 `lib/` 产物纳入该实施提交。client 改动额外要求 `npm run build:client`，纳入 `lib/client.js` 与 `lib/client-types/`；该构建使用 Node **^22.18.0 || >=24.11.0**，此工具链要求不重定义包的通用运行时下限。完整门禁序列中使用 `npm run test:build` 做测试编译检查。生成产物一律不得手改。

### 分支与提交边界

- 工作在 `perf/list-loading`。文档先行步骤只从干净基线 `d59c2b3c931a3108e78ea416bfc23c0802aa4155` 起步；分支、基线或干净状态不符，或任一目标文档已存在，即停止。
- 文档先行提交只含本文档及其中文对译，不带 CHANGELOG 改动。撰写任务止于实施之前：不跑质量门禁、不构建、不提交——后续由独立的 Verify 运行测试与门禁，通过后再经单独授权提交。本步骤不得 push、不建 worktree、不委派、不额外创建报告、台账、简报或规划产物。
- 其后每个 `perf`/`fix` 原子提交携带代码、测试、适用的生成产物与对应的 `CHANGELOG.md` 条目。条目必须自包含，说明如何验证或辨识该改动，不得引用外部评审或对话编号。纯 README/文档改动放入独立的 `docs:` 提交。本设计不新增命令或 flag，因此无需改 README。
- 每个阶段经授权提交后，交出证据并停止，不自动开始下一阶段。push 与发布始终是用户的决定；本地检查通过不构成对二者的授权。

### 终账

实施收尾时，重跑完整最终门禁，重建服务端产物与适用的客户端产物，复跑基准做最终 T1/T2 对比，并删除全部临时测量产物。交接前把最终改动文件范围与已接受的阶段边界逐一对照。

对文档-only 步骤，只做两个新文件与 Git diff 范围的自检，然后返回文件路径、六段覆盖情况、偏差或疑问与 Git 状态。不跑后续门禁，不创建独立报告文件。本文定义的是未来的验收边界；不记录任何实施、测试通过或实测提升。
