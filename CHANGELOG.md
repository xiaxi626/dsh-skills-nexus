# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
