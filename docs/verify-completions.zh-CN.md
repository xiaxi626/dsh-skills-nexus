# 验证命令补全

本指南验证 **`completions`** 命令——`dsh-skills-nexus completions --shell
<shell>` 输出的命令补全脚本：

- `--shell` 接受 `bash`、`zsh`、`fish`、`powershell` 四个值，把对应 shell 的
  脚本写到 stdout。其他值一律是用法错误（exit 2），且 **stdout 保持为空**
  ——用管道接脚本的人永远不会收到半份模板。
- 每个脚本补三层：子命令、该子命令的 flag、以及（对接受名字的
 子命令）已安装的 skill 名。「第一个位置参数」是按**忽略 `-` 开头的词**来
  数的，所以 `remove --yes <TAB>` 仍然会给出 skill 名。
- 名字层一律通过 `dsh-skills-nexus list --names` 取数；没有任何脚本读
  `manifest.json`，因此内部 schema 变化不会静默弄坏补全。

> **Shell 警告——请在每个代码块标题所写的 shell 里运行它。** bash 块在 Git
> Bash（Windows）或任何 POSIX shell 里跑；PowerShell 块在 PowerShell 里跑；
> zsh / fish 块在装有这两个 shell 的环境（macOS、Linux、WSL）里跑。切勿把
> POSIX 块粘进 PowerShell，反之亦然。所有块都用绝对路径或 `git -C <dir>`；
> 没有任何一块会留下 `cd` 副作用（fish 部分用 `pushd` 切到临时目录再切回），
> 因此不会污染你的工作区。

以下操作都是安全的：使用位于临时目录下的隔离 `DSH_HOME`，用两个本地
`file://` 上游仓库代替 GitHub（不联网），且绝不触碰你真实的 `~/.dsh`。最后
统一删除临时目录。

## 前置条件

- Node.js ≥ 20，且 `git` 在 `PATH` 中，再装上你要验证的那个 shell
- 已 checkout 仓库并执行过 `npm install`（测试依赖 `node_modules` 里的 `tsx`）
- 如果改过 `src/`，先 `npm run build`——下面的流程跑的是 `lib/` 里的编译产物

---

## 第一部分 — 测试套件（质量门禁）

```bash
npm run typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
npm run lint        # ESLint 9 + typescript-eslint
npm test            # node:test + tsx——期望：全部用例通过
npm run build       # tsc → lib/
node --import tsx --test test/completions.test.ts   # 只跑这个功能
```

| 测试文件 | 验证内容 |
|---|---|
| `test/completions.test.ts` | 参数解析（`--shell` 两种写法、不支持的 shell、用法错误时 stdout 为空）；四份模板的文本断言（子命令列表对齐 CLI 路由、每个命令的 flag、update/pull 不提供 `--yes`、走 `list --names` 且绝不读 `manifest.json`、纯 ASCII）；以及**三条在真实 bash / zsh / fish 里执行模板的测试** |

三条执行测试在对应 shell 缺失时自动跳过——Windows 开发机有 bash（Git Bash）
但没有 zsh / fish，那里会跳过两条。CI 的 Linux 作业会安装这两个 shell，保证
每次 push 都真实执行四份模板；macOS 自带 zsh。PowerShell 在本项目的 CI 里
没有 runner，其模板由文本断言钉住，规则已在 PS 5.1 上手工测定（见第二部分 /
第三部分）。

---

## 第二部分 — 端到端验证

每个代码块都是其标题所写 shell 的完整流程：先搭一套隔离环境（临时目录下的
`DSH_HOME`、两个代替 GitHub 的本地 `file://` 上游仓库），安装两个 skill
（`alpha`、`beta`）作为动态名字源，装载模板，然后对一组固定命令行打印候选
——每行形如 `label|candidates`。

### bash——Git Bash（Windows）或任意 POSIX shell

```bash
PROJECT=~/Downloads/dsh-skills-nexus                  # ← 改成你的仓库路径
PROJECT_WIN="$(cygpath -m "$PROJECT")"                # POSIX shell 里跳过这行，直接用 "$PROJECT"

TROOT="$(cygpath -m "$TEMP")/nexus-completions"       # 隔离的演练场
UP_A="$TROOT/up-alpha"
UP_B="$TROOT/up-beta"
export DSH_HOME="$TROOT/home"
BIN="$TROOT/bin"
rm -rf "$TROOT"                                       # 清掉上次残留
mkdir -p "$UP_A" "$UP_B" "$BIN"

# ---- 造两个本地上游仓库（代替 GitHub）：一个 skill 一个仓库，因为一个仓库
# ---- 只能注册一个名字（克隆目录就是 slug）
git -C "$UP_A" init -q -b main                        # git ≥ 2.28
git -C "$UP_A" config user.email t@t
git -C "$UP_A" config user.name t
printf -- '---\nname: alpha\ndescription: alpha skill\n---\n# alpha\n' > "$UP_A/SKILL.md"
git -C "$UP_A" add .
git -C "$UP_A" commit -q -m init

git -C "$UP_B" init -q -b main
git -C "$UP_B" config user.email t@t
git -C "$UP_B" config user.name t
printf -- '---\nname: beta\ndescription: beta skill\n---\n# beta\n' > "$UP_B/SKILL.md"
git -C "$UP_B" add .
git -C "$UP_B" commit -q -m init

# ---- 在 PATH 上放一个 stub CLI：模板会调 `dsh-skills-nexus list --names`，
# ---- 这行让该命令名可用，而不必全局安装
printf '#!/bin/sh\nexec node "%s/lib/cli/index.js" "$@"\n' "$PROJECT_WIN" > "$BIN/dsh-skills-nexus"
chmod +x "$BIN/dsh-skills-nexus"
export PATH="$BIN:$PATH"

# ---- 装上两个 skill，作为动态名字源 ----
dsh-skills-nexus add "file:///$UP_A" --name alpha
dsh-skills-nexus add "file:///$UP_B" --name beta
dsh-skills-nexus list --names                         # alpha、beta

# ---- 装载模板 ----
eval "$(dsh-skills-nexus completions --shell bash)"

# ---- 驱动它：把 bash 会交给补全函数的词数组原样递进去 ----
probe() {  # probe <label> <words...>；最后一个词就是正在输入的那个
  local label="$1"; shift
  local -a COMP_WORDS=("$@")
  local COMP_CWORD=$(( $# - 1 ))
  # 引擎每轮补全后都会清掉 COMPREPLY（读完立刻 unbind 该变量），这里复位
  # 是为了让每个场景都从引擎提供的同一干净状态重放——直接调用绕过了引擎，
  # 不复位的话上一个场景的候选会漏进下一个。
  COMPREPLY=()
  _dsh_skills_nexus
  printf '%s|%s\n' "$label" "${COMPREPLY[*]}"
}

probe subcommands   dsh-skills-nexus ""
probe d-prefix      dsh-skills-nexus "d"
probe add-dashes    dsh-skills-nexus add "--"
probe doctor-dashes dsh-skills-nexus doctor "--"
probe shell-bare    dsh-skills-nexus completions --shell ""
probe shell-prefix  dsh-skills-nexus completions --shell "b"
probe update-name   dsh-skills-nexus update ""
probe remove-yes    dsh-skills-nexus rm --yes ""
probe remove-second dsh-skills-nexus rm alpha ""
probe update-flag   dsh-skills-nexus update "--x"

# ---- 清理 ----
rm -rf "$TROOT"
unset DSH_HOME
# $BIN 只留在本 shell 会话的 PATH 里
```

期望输出：

```
subcommands|add list ls update pull remove rm enable disable doctor help completions
d-prefix|disable doctor
add-dashes|--name --ref --subdir --yes
doctor-dashes|--json --updates --quiet
shell-bare|bash zsh fish powershell
shell-prefix|bash
update-name|alpha beta
remove-yes|alpha beta
remove-second|
update-flag|
```

两行空白才是重点：skill 名只属于**第一个**位置参数槽（`rm alpha <TAB>` 已
没有第二个槽可填），而 update/pull 没有任何 flag 可补。行尾的空词是 bash
表达「刚敲了一个空格」的方式。与 PowerShell 不同，bash 对裸 `--` 照常列出
全部 flag（上面的 `doctor-dashes`）。

### PowerShell——Windows

```powershell
# ---- 环境：隔离的 DSH_HOME + 两个本地上游仓库（代替 GitHub）----
$PROJ = 'C:/Users/you/dsh-skills-nexus'               # ← 改成你的仓库路径（用正斜杠）
$TROOT = (Join-Path $env:TEMP 'nexus-completions').Replace('\', '/')
$UP_A = "$TROOT/up-alpha"
$UP_B = "$TROOT/up-beta"
$BIN = "$TROOT/bin"
$env:DSH_HOME = "$TROOT/home"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TROOT
New-Item -ItemType Directory -Force -Path $UP_A, $UP_B, $BIN | Out-Null

git -C $UP_A init -q -b main
git -C $UP_A config user.email t@t
git -C $UP_A config user.name t
[System.IO.File]::WriteAllText("$UP_A/SKILL.md", "---`nname: alpha`ndescription: alpha skill`n---`n# alpha`n")
git -C $UP_A add .
git -C $UP_A commit -q -m init

git -C $UP_B init -q -b main
git -C $UP_B config user.email t@t
git -C $UP_B config user.name t
[System.IO.File]::WriteAllText("$UP_B/SKILL.md", "---`nname: beta`ndescription: beta skill`n---`n# beta`n")
git -C $UP_B add .
git -C $UP_B commit -q -m init

# ---- 在 PATH 上放一个 stub CLI（包一层 .cmd 指向 lib/）----
Set-Content "$BIN/dsh-skills-nexus.cmd" "@node `"$PROJ/lib/cli/index.js`" %*"
$env:PATH = "$BIN;$env:PATH"

dsh-skills-nexus add "file:///$UP_A" --name alpha
dsh-skills-nexus add "file:///$UP_B" --name beta
dsh-skills-nexus list --names                         # alpha beta

# ---- 把模板装载进当前会话 ----
dsh-skills-nexus completions --shell powershell | Out-String | Invoke-Expression

# ---- 通过引擎自己的补全 API 驱动它 ----
function Show($label, $line) {
  $r = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)
  $txt = ($r.CompletionMatches | ForEach-Object { $_.CompletionText }) -join ' '
  "{0}|{1}" -f $label, $txt
}
Show subcommands   'dsh-skills-nexus '
Show d-prefix      'dsh-skills-nexus d'
Show add-prefix    'dsh-skills-nexus add --n'
Show shell-bare    'dsh-skills-nexus completions --shell '
Show shell-prefix  'dsh-skills-nexus completions --shell b'
Show update-name   'dsh-skills-nexus update '
Show remove-yes    'dsh-skills-nexus rm --yes '
Show remove-second 'dsh-skills-nexus rm alpha '
Show update-flag   'dsh-skills-nexus update --x'

# ---- 清理 ----
Remove-Item -Recurse -Force $TROOT
Remove-Item Env:DSH_HOME
# $BIN 只留在本会话的 PATH 里
```

期望输出：

```
subcommands|add list ls update pull remove rm enable disable doctor help completions
d-prefix|disable doctor
add-prefix|--name
shell-bare|bash zsh fish powershell
shell-prefix|bash
update-name|alpha beta
remove-yes|alpha beta
remove-second|（你运行本块所在目录里的文件名——引擎回落行为，见第三部分）
update-flag|
```

`remove-second` 是那行异类：补全器没有候选时，PowerShell 会回落到**文件名**
补全，于是它列出你身边的文件。这是引擎行为，脚本无法抑制——`git rm alpha
<TAB>` 也一样。另注意 `Register-ArgumentCompleter` 只影响它运行的那个会话：
想让补全永久生效，把启用行加进你的 `$PROFILE`。

### zsh 与 fish——macOS / Linux / WSL

这两个 shell 都在 POSIX 侧，所以共用一个环境。先用 bash 跑环境块，然后**在同一
终端里**启动你要验证的 shell（子 shell 会继承 `DSH_HOME` 和 `PATH`）。

```bash
# ---- 环境（bash）：与上面两块同构，路径用 /tmp ----
PROJECT=~/dsh-skills-nexus                           # ← 改成你的仓库路径
TROOT=/tmp/nexus-completions
UP_A=$TROOT/up-alpha
UP_B=$TROOT/up-beta
export DSH_HOME=$TROOT/home
BIN=$TROOT/bin
rm -rf "$TROOT"
mkdir -p "$UP_A" "$UP_B" "$BIN"

git -C "$UP_A" init -q -b main
git -C "$UP_A" config user.email t@t
git -C "$UP_A" config user.name t
printf -- '---\nname: alpha\ndescription: alpha skill\n---\n# alpha\n' > "$UP_A/SKILL.md"
git -C "$UP_A" add .
git -C "$UP_A" commit -q -m init

git -C "$UP_B" init -q -b main
git -C "$UP_B" config user.email t@t
git -C "$UP_B" config user.name t
printf -- '---\nname: beta\ndescription: beta skill\n---\n# beta\n' > "$UP_B/SKILL.md"
git -C "$UP_B" add .
git -C "$UP_B" commit -q -m init

printf '#!/bin/sh\nexec node "%s/lib/cli/index.js" "$@"\n' "$PROJECT" > "$BIN/dsh-skills-nexus"
chmod +x "$BIN/dsh-skills-nexus"
export PATH="$BIN:$PATH"

dsh-skills-nexus add "file://$UP_A" --name alpha
dsh-skills-nexus add "file://$UP_B" --name beta
dsh-skills-nexus list --names                        # alpha、beta
```

#### zsh

```zsh
# （在同一终端里启动 zsh，以继承 DSH_HOME / PATH）

# ---- 非交互驱动，与测试套件同一套做法：`compadd` 只在真实补全里工作，
# ---- 这里改为记录它的实参；`compdef` 平时由 compinit 提供，也一并 stub
compdef() { :; }
compadd() {
  if [[ $1 == -a ]]; then
    CAND+=( "${(P)2}" )      # zsh 间接展开：展开 $2 所命名的数组
  else
    CAND+=( "$@" )
  fi
}
run() {  # run <label> <words...>；最后一个词就是正在输入的那个
  local -a words CAND
  local CURRENT
  label=$1; shift
  words=("$@")
  CURRENT=$#
  CAND=()
  _dsh_skills_nexus
  print -r -- "$label|${(j: :)CAND}"
}

eval "$(dsh-skills-nexus completions --shell zsh)"

run sub                dsh-skills-nexus ''
run add-flags          dsh-skills-nexus add '--n'
run doctor-bare-dashes dsh-skills-nexus doctor '--'
run shell-values       dsh-skills-nexus completions --shell ''
run update-names       dsh-skills-nexus update ''
run remove-yes         dsh-skills-nexus remove --yes ''
run remove-second      dsh-skills-nexus remove alpha ''
run update-flag        dsh-skills-nexus update '--x'
run unknown-cmd        dsh-skills-nexus nope ''
```

期望输出：

```
sub|add list ls update pull remove rm enable disable doctor help completions
add-flags|-- --name --ref --subdir --yes
doctor-bare-dashes|-- --json --updates --quiet
shell-values|bash zsh fish powershell
update-names|alpha beta
remove-yes|alpha beta
remove-second|
update-flag|
unknown-cmd|
```

候选是**刻意不过滤**记录的——过滤由 zsh 自己负责，这套驱动校验的是层的判定
逻辑（什么样的命令行该产出哪一组候选），而不是最终菜单；两行开头的 `--` 是
`compadd` 自身的选项终止符。交互式的端到端检查才是真家伙：先
`eval "$(dsh-skills-nexus completions --shell zsh)"`，然后手工敲
`dsh-skills-nexus <TAB>`、`dsh-skills-nexus doctor --<TAB>`、
`dsh-skills-nexus rm --yes <TAB>` 看菜单。上面这些行同时也是测试套件在
Linux 与 macOS 上执行的断言。

#### fish

```fish
# （在同一终端里启动 fish，以继承 DSH_HOME / PATH）
dsh-skills-nexus completions --shell fish | source

# `complete -C '<cmdline>'` 是 fish 自带的「这里你会得到什么」——引擎会
# 评估所有规则并打印候选，不需要终端。请在空目录里跑：没有规则命中时 fish
# 会混入文件名补全，空目录能把这层噪音挡掉。
set -l tmp (mktemp -d); pushd $tmp

complete -C 'dsh-skills-nexus '                       # 全部 12 个子命令
complete -C 'dsh-skills-nexus d'                      # disable、doctor
complete -C 'dsh-skills-nexus add --'                 # --name --ref --subdir --yes
complete -C 'dsh-skills-nexus doctor --'              # --json --quiet --updates
complete -C 'dsh-skills-nexus completions --shell b'  # bash
complete -C 'dsh-skills-nexus update '                # alpha、beta
complete -C 'dsh-skills-nexus remove --yes '          # 含 alpha、beta
complete -C 'dsh-skills-nexus remove alpha '          # 不再给 alpha / beta——已不是第一个槽
complete -C 'dsh-skills-nexus update --x'             # 无

popd
rm -rf $tmp
```

这里的候选是**完整过滤后**的——驱动它的是 fish 的真实引擎，不是记录 stub。
空槽位上 fish 可能连选项名本身也列出（`remove --yes ` 会在名字旁带上
`--yes`），所以这些位置只对「有意义的候选」下断言。同样的集合也由测试套件
断言（CI 的 Linux 作业执行；macOS 默认镜像不含 fish）。

最后清掉共享环境：

```bash
rm -rf /tmp/nexus-completions
unset DSH_HOME
```

---

## 第三部分 — 值得知道的引擎行为（不是缺陷）

1. **bash 的候选不会跨轮次残留。** 每轮补全结束后，引擎会读取 `COMPREPLY`
   并立刻 unbind 该变量（`pcomplete.c` 的 `gen_shell_function_matches`），
   所以上一轮的值不可能漏进下一次调用。上面的驱动之所以复位 `COMPREPLY`，
   只是因为它绕过了引擎直接调用函数。
2. **裸 `-` 或 `--` 在 bash、zsh、fish 里能到达补全函数——PowerShell 不行。**
   PS 5.1 上，光标处的词恰好是 `-` 或 `--` 时，引擎根本不会调用任何参数
   补全器（用 `git` 做对照测得，行为一致），因此 `doctor --` 什么都不显示；
   再多一个字符（`doctor --j`）就正常补全。bash 则照常为 `doctor --` 列出
   全部三个 flag。
3. **PowerShell 用文件名回答「没有候选」。** 补全器返回空集时，引擎回落到
   文件名补全——即上面 `remove-second` 那行。同样的空答案补全器对 `git`
   做对照实验，行为完全相同，所以这是引擎策略而非模板问题。bash、zsh、
   fish 则安静地没有候选。

---

## 实践中遇到的坑

1. **跑编译后的 CLI**——本流程用的是 `lib/`；改过 `src/` 后先 `npm run build`。
2. **一个仓库只能注册一个名字。** 环境里之所以造两个上游仓库，是因为同一仓库
   用不同 `--name` 注册两次会失败，报 *"A skill named ... is already
   registered"*（克隆目录就是仓库 slug）。
3. **平台路径格式。** Windows Git Bash：用 `cygpath -m` 转换并用
   `file:///C:/...` URL。Linux / macOS：用普通绝对路径与 `file:///...` URL。
4. **stub 是脚手架，不是产品。** 真实用户通过 `npm install -g` 把命令放进
   `PATH`；stub 只是让命令名指向 `lib/`，免去全局安装。
5. **`git init -b main` 需要 git ≥ 2.28**（2019）。更旧版本：
   `git init && git -C "$UP_A" symbolic-ref HEAD refs/heads/main`。
6. **zsh 需要 `compinit`**（交互式 shell 会跑，它定义了 `compdef`）；驱动块
   同时 stub 了 `compdef` 与 `compadd`，因为二者都只在真实补全里工作。
7. **fish 在无匹配时显示文件名**——`complete -C` 请在空目录里跑（块里就是
   这么做的），否则当前目录的文件会淹没信号。
8. **PowerShell 需要允许本地脚本的执行策略**；并非每个 5.1 构建都有
   `Set-Content -NoNewline`——环境块之所以用
   `[System.IO.File]::WriteAllText` 写 `SKILL.md`，就是这个原因。
9. **残留的 `$DSH_HOME`**——上一次运行会留下条目。每个块开头都会先删掉自己
   的临时目录；重跑之前照做。

---

## 覆盖边界

本指南**不**覆盖（皆为刻意取舍）：

- **候选之外的交互行为**——菜单布局、匹配风格、高亮：候选集正确之后，这些
  都是 shell 补全系统自己的事。
- **Windows 上的 zsh / fish**——Windows 不带这两个 shell；测试套件在那里
  跳过它们，CI 的 Linux 作业安装两者，macOS 自带 zsh。
- **CI 里的 PowerShell**——本项目 CI 没有 Windows PowerShell runner；模板
  规则在 PS 5.1 上手工测定（见第三部分），并由测试套件以文本断言钉住。
- **zsh 的候选过滤**——zsh 驱动记录的是 matcher 运行之前各层给出的候选；
  过滤本身是 shell 的职责。
- **真实 GitHub 网络**——本地 `file://` 上游走的是同一条 clone +
  `list --names` 路径，却没有网络抖动。
- **Node 20 / 22 / 24 矩阵**——CI（`.github/workflows/ci.yml`）在 push/PR 上跑
  完整质量门禁。
