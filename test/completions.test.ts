import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { completions, parseCompletionsArgs, SUPPORTED_SHELLS } from '../src/cli/commands/completions.js'
import { printHelp, HELP_TEXT, ROUTED_SUBCOMMANDS } from '../src/cli/usage.js'
import { bashTemplate } from '../src/cli/commands/completions/bash.js'
import { fishTemplate } from '../src/cli/commands/completions/fish.js'
import { powershellTemplate } from '../src/cli/commands/completions/powershell.js'
import { zshTemplate } from '../src/cli/commands/completions/zsh.js'

/**
 * Tests for the `completions` command and its shell templates.
 *
 * `completions` is pure output — no FS, no git, no manifest — so there is no
 * environment to isolate: each test captures stdout/stderr and asserts on the
 * emitted bytes.
 *
 * The templates duplicate the subcommand and flag lists that live in the CLI
 * router and in `--help`, so the drift guards here compare the templates
 * against `src/cli/index.ts` itself rather than against a second hardcoded
 * copy, which would only prove the copy matches itself.
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The four templates, with the spelling each one uses for a long option:
 * fish declares options as `-l name`, which is what its rules offer to the
 * user as `--name`, so the flag drift guards need that translation.
 */
const TEMPLATES = [
  { shell: 'bash', text: bashTemplate, flag: (f: string) => f },
  { shell: 'zsh', text: zshTemplate, flag: (f: string) => f },
  { shell: 'fish', text: fishTemplate, flag: (f: string) => `-l ${f.slice(2)}` },
  { shell: 'powershell', text: powershellTemplate, flag: (f: string) => f },
]

/** Capture whatever `completions()` writes, returning the exit code too. */
function capture(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: any) => {
    out.push(String(chunk))
    return true
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (chunk: any) => {
    err.push(String(chunk))
    return true
  }
  try {
    const code = completions(argv)
    return { code, out: out.join(''), err: err.join('') }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

/**
 * The `case` labels `src/cli/index.ts` actually routes, scraped from its
 * source. `-h` / `--help` are excluded by requiring a leading letter, and the
 * `help` word is kept because it is a real alias.
 *
 * Returns `undefined` when the source file is not reachable — the suite also
 * runs from `test-dist/`, where only compiled JavaScript exists. The one test
 * that uses this then falls back to the router's own exported
 * `ROUTED_SUBCOMMANDS`, and says so.
 */
async function routedSubcommandsFromSource(): Promise<string[] | undefined> {
  let src: string
  try {
    src = await readFile(new URL('../src/cli/index.ts', import.meta.url), 'utf8')
  } catch {
    return undefined
  }
  const names = new Set<string>()
  for (const m of src.matchAll(/^\s*case '([a-z][a-z-]*)':$/gm)) names.add(m[1]!)
  return [...names].sort()
}

/**
 * The routed subcommand aliases, sorted — what the four templates must offer.
 *
 * Prefers the dispatcher's own `case` labels when the `.ts` source is reachable
 * (the normal `npm test` run) and falls back to the exported constant when it is
 * not (`test-dist/`, which holds only compiled JavaScript). Either way the
 * templates are compared against the router's contract, never against a second
 * hand-written copy of the list.
 */
async function routedSubcommands(): Promise<string[]> {
  return (await routedSubcommandsFromSource()) ?? [...ROUTED_SUBCOMMANDS].sort()
}
/** Subcommands a bash template offers, read out of its `cmds` variable. */
function bashSubcommands(template: string): string[] {
  const m = /local cmds="([^"]+)"/.exec(template)
  assert.ok(m, 'bash template must declare a cmds variable')
  return m[1]!.split(/\s+/).sort()
}

/** Subcommands a PowerShell template offers, read out of its `$cmds` array. */
function powershellSubcommands(template: string): string[] {
  const m = /\$cmds = (.+)$/m.exec(template)
  assert.ok(m, 'powershell template must declare a $cmds array')
  return m[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort()
}

/** Subcommands a zsh template offers, read out of its `cmds` array. */
function zshSubcommands(template: string): string[] {
  const m = /cmds=\(([^)]+)\)/.exec(template)
  assert.ok(m, 'zsh template must declare a cmds array')
  return m[1]!.split(/\s+/).sort()
}

/** Subcommands a fish template offers, read out of its subcommand rule. */
function fishSubcommands(template: string): string[] {
  const m = /__fish_use_subcommand' -a '([^']+)'/.exec(template)
  assert.ok(m, 'fish template must offer subcommands for __fish_use_subcommand')
  return m[1]!.split(/\s+/).sort()
}

/* ------------------------------------------------------------------ */
/* parseCompletionsArgs — value option, both spellings                 */
/* ------------------------------------------------------------------ */

test('--shell takes its value as the next argument', () => {
  assert.deepEqual(parseCompletionsArgs(['--shell', 'bash']), { shell: 'bash' })
})

test('--shell=value is equivalent to the space form', () => {
  assert.deepEqual(parseCompletionsArgs(['--shell=powershell']), { shell: 'powershell' })
})

test('a missing --shell is a usage error', () => {
  assert.throws(() => parseCompletionsArgs([]), /--shell is required/)
})

test('--shell without a value and --shell= with an empty value both throw', () => {
  assert.throws(() => parseCompletionsArgs(['--shell']), /requires a shell name/)
  assert.throws(() => parseCompletionsArgs(['--shell=']), /requires a shell name/)
})

test('an unsupported shell throws instead of falling back to another shell', () => {
  assert.throws(() => parseCompletionsArgs(['--shell', 'cmd']), /unsupported shell "cmd"/)
  assert.throws(() => parseCompletionsArgs(['--shell', 'sh']), /unsupported shell "sh"/)
})

test('every supported shell is accepted', () => {
  for (const shell of SUPPORTED_SHELLS) assert.deepEqual(parseCompletionsArgs(['--shell', shell]), { shell })
})

test('positionals and unknown flags are usage errors', () => {
  assert.throws(() => parseCompletionsArgs(['bash']), /unknown argument/)
  assert.throws(() => parseCompletionsArgs(['--shell', 'bash', 'extra']), /unknown argument/)
  assert.throws(() => parseCompletionsArgs(['--nope']), /unknown argument/)
})

/* ------------------------------------------------------------------ */
/* completions — stdout is the script, verbatim                        */
/* ------------------------------------------------------------------ */

test('each shell emits its own template and nothing else', () => {
  for (const t of TEMPLATES) {
    const { code, out } = capture(['--shell', t.shell])
    assert.equal(code, 0, `${t.shell} should exit 0`)
    assert.equal(out, t.text, `${t.shell} should emit its template byte for byte`)
  }
})

test('the four templates are four different scripts', () => {
  const texts = TEMPLATES.map((t) => t.text)
  assert.equal(new Set(texts).size, TEMPLATES.length, 'a wiring mistake would map two shells to one script')
})

test('--shell=bash emits the same bytes as the space form', () => {
  assert.equal(capture(['--shell=bash']).out, capture(['--shell', 'bash']).out)
})

test('every supported shell emits a template that ends in a newline', () => {
  for (const shell of SUPPORTED_SHELLS) {
    const { code, out } = capture(['--shell', shell])
    assert.equal(code, 0, `${shell} should exit 0`)
    assert.ok(out.endsWith('\n'), `${shell} template should end with a newline`)
    assert.ok(out.length > 0, `${shell} template should not be empty`)
  }
})

test('a usage error exits 2 and leaves stdout empty (a script pipes it)', () => {
  for (const argv of [[], ['--shell'], ['--shell', 'cmd'], ['--shell=', 'x'], ['--nope']]) {
    const { code, out, err } = capture(argv)
    assert.equal(code, 2, `argv ${JSON.stringify(argv)} should exit 2`)
    assert.equal(out, '', `argv ${JSON.stringify(argv)} must write nothing to stdout`)
    assert.match(err, /error: /, `argv ${JSON.stringify(argv)} should explain on stderr`)
  }
})

/* ------------------------------------------------------------------ */
/* Templates — drift guards against the CLI router                     */
/* ------------------------------------------------------------------ */

test('every template offers exactly the subcommands the CLI routes', async () => {
  const fromSource = await routedSubcommandsFromSource()
  const routed = fromSource ?? [...ROUTED_SUBCOMMANDS].sort()
  // Guard the guard: a regexp that silently matched nothing would make the
  // comparisons below vacuous.
  assert.ok(routed.length >= 10, `expected the router to yield subcommands, got ${routed.length}`)
  if (fromSource !== undefined) {
    // The router's own `case` labels are the authority when they are readable;
    // the exported constant only has to agree with them. A compiled run
    // (`test-dist/`) has no `.ts` to read, so this half self-skips and the
    // constant stands in for it.
    assert.deepEqual([...ROUTED_SUBCOMMANDS].sort(), routed, 'ROUTED_SUBCOMMANDS drifted from the router')
  }
  assert.deepEqual(bashSubcommands(bashTemplate), routed)
  assert.deepEqual(zshSubcommands(zshTemplate), routed)
  assert.deepEqual(fishSubcommands(fishTemplate), routed)
  assert.deepEqual(powershellSubcommands(powershellTemplate), routed)
})

test('templates carry the flags each command accepts', () => {
  for (const t of TEMPLATES) {
    for (const flag of ['--name', '--ref', '--subdir', '--yes', '--names', '--json', '--updates', '--quiet', '--shell']) {
      assert.ok(t.text.includes(t.flag(flag)), `${t.shell} template should offer ${flag}`)
    }
  }
})

test('templates never offer --yes where the command rejects it', () => {
  // The original design draft listed `update --yes`. `update` now parses flags
  // (only `--json`), so an advertised `--yes` would be a usage error rather
  // than the silent no-op it used to be — still a lie, and now a loud one.
  // The same goes for the batched enable/disable, which take `--json` only.
  assert.doesNotMatch(bashTemplate, /update\|pull\|rollback\)\s+flags="[^"]*--yes/)
  assert.doesNotMatch(zshTemplate, /update\|pull\|rollback\)\s+compadd -- [^\n]*--yes/)
  assert.doesNotMatch(fishTemplate, /__fish_seen_subcommand_from [^']*\b(?:update|pull)\b[^']*' -l yes/)
  assert.doesNotMatch(powershellTemplate, /'update'\s*\{[^}]*--yes/)
  assert.doesNotMatch(bashTemplate, /enable\|disable\)\s+flags="[^"]*--yes/)
  assert.doesNotMatch(zshTemplate, /enable\|disable\)\s+compadd -- [^\n]*--yes/)
  assert.doesNotMatch(fishTemplate, /__fish_seen_subcommand_from enable disable' -l yes/)
  assert.doesNotMatch(powershellTemplate, /'enable'\s*\{[^}]*--yes/)
  assert.doesNotMatch(powershellTemplate, /'disable'\s*\{[^}]*--yes/)
})

test('every template counts positionals, so flags do not consume the slot', () => {
  // `remove --yes <TAB>` must still offer names, because --yes is accepted
  // before the names. Every template counts the words that do not start with
  // `-` instead of comparing a raw slot index - the slot comparison was the
  // bug this pins. bash, zsh and fish are also executed below; PowerShell has
  // no runner in this project's CI, so its rule is pinned as text only.
  assert.match(bashTemplate, /nargs=\$\(\(nargs \+ 1\)\)/)
  assert.match(zshTemplate, /nargs=\$\(\( nargs \+ 1 \)\)/)
  assert.match(fishTemplate, /string match -qr -- \^- "\$t\[\$i\]"/)
  assert.match(powershellTemplate, /\$nargs = @\(\$els\[2\.\.\(\$done - 1\)\] \| Where-Object \{ \$_ -notlike '-\*' \}\)\.Count/)
  assert.doesNotMatch(powershellTemplate, /\$slot -eq /)
})

test('dynamic completion shells out to `list --names`, never to manifest.json', () => {
  // The whole reason `list --names` exists: going through the CLI keeps an
  // internal schema change from silently breaking completion.
  for (const t of TEMPLATES) {
    assert.match(t.text, /list --names/, `${t.shell} should ask the CLI for names`)
    assert.doesNotMatch(t.text, /manifest\.json/, `${t.shell} must not read internal state`)
  }
})

test('templates are pure ASCII so the emitted bytes survive any encoding', () => {
  for (const t of TEMPLATES) {
    assert.match(t.text, /^[\x00-\x7F]*$/, `${t.shell} template should be ASCII`)
  }
})

test('templates hold no unescaped TS template interpolation of their own', () => {
  // A regression guard for the join-based construction: if someone rewrites
  // these as template literals the shell's `${...}` / `$(...)` would be eaten,
  // so assert the runtime characters are present in the output.
  assert.ok(bashTemplate.includes('${COMP_WORDS[COMP_CWORD]}'))
  assert.ok(bashTemplate.includes('$(compgen'))
  assert.ok(zshTemplate.includes('${words[CURRENT]}'))
  assert.ok(zshTemplate.includes('$(dsh-skills-nexus list --names'))
  assert.ok(fishTemplate.includes('(commandline -opc)'))
  assert.ok(fishTemplate.includes('(dsh-skills-nexus list --names'))
  assert.ok(powershellTemplate.includes('$wordToComplete'))
})

/* ------------------------------------------------------------------ */
/* Templates — flags measured against the help text                    */
/* ------------------------------------------------------------------ */

test('every flag documented in --help is offered by all four templates', () => {
  // The help text is a named export of the usage module, not a scraped function
  // body: A1 moved the write from `process.stdout.write` to `io.emit`, and a
  // regexp keyed to the old call shape would have failed for a change that
  // produced byte-identical output. Run the printer into a fake OpsIO and
  // measure the flag set against what the CLI actually prints — so the guard
  // cannot drift from the real bytes, and it needs no source file access (which
  // a compiled test run cannot provide).
  const chunks: string[] = []
  printHelp({
    interactive: false,
    confirm: () => Promise.resolve(false),
    progress: () => {},
    emit: (line: string) => {
      chunks.push(line)
    },
    error: () => {},
  })
  const help = chunks.join('')
  assert.equal(help, HELP_TEXT, 'printHelp must emit HELP_TEXT verbatim')

  // `--flag=value` appears in the prose explaining the value-option spelling;
  // it is an example, not a flag, and no template may be expected to offer it.
  const documented = new Set(
    [...help.matchAll(/--[a-z-]+/g)].map((m) => m[0]).filter((f) => f !== '--flag'),
  )
  // Guard the guard: a regexp that matched nothing would make this vacuous.
  assert.ok(documented.size >= 8, `help should document flags, got ${documented.size}`)

  for (const t of TEMPLATES) {
    for (const flag of documented)
      assert.ok(t.text.includes(t.flag(flag)), `${t.shell} template should offer documented ${flag}`)
  }
})

test('every template offers exactly the shells --shell accepts', () => {
  // The `--shell` value list is a second copy of SUPPORTED_SHELLS, in each
  // template's own idiom; teaching the CLI about a shell without teaching the
  // templates would make completion offer a name the CLI rejects.
  const expected = [...SUPPORTED_SHELLS].sort()
  const extract: Record<string, RegExp> = {
    bash: /\[ "\$prev" = "--shell" \]; then\n\s*COMPREPLY=\( \$\(compgen -W "([^"]+)"/,
    zsh: /\$\{words\[CURRENT-1\]\} == --shell \]\]; then\n\s*compadd -- ([^\n]+)/,
    fish: /-l shell -r -a '([^']+)'/,
    powershell: /\$prev -eq '--shell'\) \{\n\s*\$candidates = ([^\n]+)/,
  }
  for (const t of TEMPLATES) {
    const m = extract[t.shell]!.exec(t.text)
    assert.ok(m, `${t.shell} template must complete the --shell value`)
    const shells = m[1]!.split(/[',\s]+/).filter((s) => s !== '').sort()
    assert.deepEqual(shells, expected, `${t.shell} template should offer every supported shell`)
  }
})

/* ------------------------------------------------------------------ */
/* Templates — executed in a real bash                                 */
/* ------------------------------------------------------------------ */

/**
 * The template assertions above only read the script. These RUN it: a `case`
 * that matches nothing, or a loop that never iterates, still reads fine.
 *
 * A shell has to be present, and that is not something this project controls:
 * a Windows dev box has bash (Git Bash) and PowerShell but no zsh/fish, and CI
 * has bash and zsh on Linux and macOS. A missing shell skips its test, which is
 * why the CI workflow installs zsh and fish on the Linux job — a skipped test
 * on every runner would mean the template ships unexecuted.
 */
function hasShell(shell: string, args: string[]): boolean {
  try {
    return spawnSync(shell, args, { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

const HAS_BASH = hasShell('bash', ['-c', 'exit 0'])
const HAS_ZSH = hasShell('zsh', ['-f', '-c', 'exit 0'])
const HAS_FISH = hasShell('fish', ['-c', 'exit 0'])
const PS_SHELL = process.platform === 'win32' ? 'powershell' : 'pwsh'
const HAS_POWERSHELL = hasShell(PS_SHELL, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'])

/**
 * A temp directory holding an executable stub `dsh-skills-nexus` that answers
 * `list --names`, so the dynamic layer is exercised against fixed data
 * (`alpha`/`beta`) instead of whatever the developer happens to have
 * installed.
 */
async function makeStubDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-completions-'))
  const stub = join(dir, 'dsh-skills-nexus')
  await writeFile(stub, '#!/bin/sh\n[ "$1" = list ] && printf "alpha\\nbeta\\n"\n')
  await chmod(stub, 0o755)
  return dir
}

test('PowerShell 实际补全 rollback 的名字、JSON，且不补第二个名字', { skip: !HAS_POWERSHELL }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-ps-completion-'))
  try {
    await writeFile(join(dir, 'dsh-skills-nexus.ps1'), "param([string]$action, [string]$option)\n'alpha'\n'beta'\n")
    const program = [
      'Invoke-Expression $env:DSH_TPL',
      "$cases = @('dsh-skills-nexus roll', 'dsh-skills-nexus rollback --j', 'dsh-skills-nexus rollback --json ', 'dsh-skills-nexus rollback alpha ')",
      '$result = @($cases | ForEach-Object {',
      '  $line = $_',
      '  $matches = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null).CompletionMatches',
      "  @($matches | ForEach-Object { $_.CompletionText }) -join '|'",
      '})',
      'ConvertTo-Json -Compress -InputObject $result',
    ].join('\n')
    const result = spawnSync(PS_SHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')], {
      encoding: 'utf8', cwd: dir,
      env: { ...process.env, PATH: [dir, process.env.PATH ?? ''].join(delimiter), DSH_TPL: powershellTemplate },
    })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    const values = JSON.parse(result.stdout.trim()) as string[]
    assert.deepEqual(values.slice(0, 3), ['rollback', '--json', 'alpha|beta'])
    assert.ok(!values[3]?.split('|').some((s) => s === 'alpha' || s === 'beta'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/**
 * Run `cases` through the emitted bash template and return one
 * `label|space-joined-candidates` line per case.
 *
 * The template is handed over in an environment variable and `eval`ed inside the
 * child, so its own `${...}` / `$(...)` are expanded by bash and not by whoever
 * passed the program.
 */
function runInBash(cases: string[][], stubDir: string): string[] {
  const program = [
    'eval "$DSH_TPL"',
    'run() {',
    '  label="$1"; shift',
    '  COMPREPLY=()',
    '  COMP_WORDS=("$@")',
    '  COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1 ))',
    '  _dsh_skills_nexus',
    '  printf "%s|%s\\n" "$label" "${COMPREPLY[*]}"',
    '}',
    ...cases.map((c) => `run ${c.map((w) => `'${w}'`).join(' ')}`),
  ].join('\n')
  const res = spawnSync('bash', ['-c', program], {
    encoding: 'utf8',
    // `delimiter`, not ':', or Windows cannot find bash in the child at all.
    env: { ...process.env, PATH: [stubDir, process.env.PATH ?? ''].join(delimiter), DSH_TPL: bashTemplate },
  })
  const why = res.error ? res.error.message : (res.stderr ?? '')
  assert.equal(res.status, 0, `bash exited with ${String(res.status)}: ${why}`)
  return res.stdout.split('\n').filter((l) => l !== '')
}

test('the emitted bash template completes correctly in a real bash', { skip: !HAS_BASH }, async () => {
  const routed = await routedSubcommands()
  const stubDir = await makeStubDir()
  try {
    const lines = runInBash(
      [
        ['sub', 'dsh-skills-nexus', ''],
        ['sub-prefix-d', 'dsh-skills-nexus', 'd'],
        ['add-flag', 'dsh-skills-nexus', 'add', '--n'],
        ['add-bare-dashes', 'dsh-skills-nexus', 'add', '--'],
        ['doctor-bare-dashes', 'dsh-skills-nexus', 'doctor', '--'],
        ['shell-bare', 'dsh-skills-nexus', 'completions', '--shell', ''],
        ['shell-b', 'dsh-skills-nexus', 'completions', '--shell', 'b'],
        ['update-skill', 'dsh-skills-nexus', 'update', ''],
        ['rollback-skill', 'dsh-skills-nexus', 'rollback', '--json', ''],
        ['rollback-flag', 'dsh-skills-nexus', 'rollback', '--'],
        ['rollback-second', 'dsh-skills-nexus', 'rollback', 'alpha', ''],
        ['remove-yes', 'dsh-skills-nexus', 'remove', '--yes', ''],
        ['remove-second', 'dsh-skills-nexus', 'remove', 'alpha', ''],
        ['update-flag', 'dsh-skills-nexus', 'update', '--x'],
        ['unknown-cmd', 'dsh-skills-nexus', 'nope', ''],
      ],
      stubDir,
    )

    // The subcommand case is compared against the router itself, not a copy.
    const [subCase, ...rest] = lines
    const [label, items] = subCase!.split('|')
    assert.equal(label, 'sub')
    assert.deepEqual(items!.split(' ').sort(), routed)

    assert.deepEqual(rest, [
      'sub-prefix-d|disable doctor',
      'add-flag|--name',
      // bash has no trouble with a bare `--`; PowerShell cannot reach its
      // completer at all there, which is why there is no mirror assertion.
      'add-bare-dashes|--name --ref --subdir --yes --json',
      'doctor-bare-dashes|--json --updates --quiet',
      'shell-bare|bash zsh fish powershell',
      'shell-b|bash',
      'update-skill|alpha beta',
      'rollback-skill|alpha beta',
      'rollback-flag|--json',
      'rollback-second|',
      // `--yes` is accepted before the names, so it must not consume the slot.
      'remove-yes|alpha beta',
      'remove-second|',
      'update-flag|',
      'unknown-cmd|',
    ])
  } finally {
    await rm(stubDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* Templates — executed in a real zsh                                 */
/* ------------------------------------------------------------------ */

/**
 * Run `cases` through the emitted zsh template and return one
 * `label|space-joined-candidates` line per case, the same shape as the bash
 * harness.
 *
 * `compadd` only works inside a real completion, so it is replaced by a
 * recorder: this test is about which candidates the script computes for which
 * command line - the branch logic, where a completion is most likely to
 * silently produce nothing - not about how zsh then filters them. `compdef`
 * is stubbed for the same reason (it comes from compinit).
 */
function runInZsh(cases: string[][], stubDir: string): string[] {
  const program = [
    'compdef() { :; }',
    'compadd() {',
    '  if [[ $1 == -a ]]; then',
    '    CAND+=( "${(P)2}" )',
    '  else',
    '    CAND+=( "$@" )',
    '  fi',
    '}',
    'eval "$DSH_TPL"',
    'run() {',
    '  local -a words CAND',
    '  local CURRENT',
    '  label=$1; shift',
    '  words=("$@")',
    '  CURRENT=$#',
    '  CAND=()',
    '  _dsh_skills_nexus',
    '  print -r -- "$label|${(j: :)CAND}"',
    '}',
    ...cases.map((c) => `run ${c.map((w) => `'${w}'`).join(' ')}`),
  ].join('\n')
  const res = spawnSync('zsh', ['-f', '-c', program], {
    encoding: 'utf8',
    // `delimiter`, not ':', or Windows cannot find the shell in the child.
    env: { ...process.env, PATH: [stubDir, process.env.PATH ?? ''].join(delimiter), DSH_TPL: zshTemplate },
  })
  const why = res.error ? res.error.message : (res.stderr ?? '')
  assert.equal(res.status, 0, `zsh exited with ${String(res.status)}: ${why}`)
  return res.stdout.split('\n').filter((l) => l !== '')
}

test('the emitted zsh template completes correctly in a real zsh', { skip: !HAS_ZSH }, async () => {
  const routed = await routedSubcommands()
  const stubDir = await makeStubDir()
  try {
    const lines = runInZsh(
      [
        ['sub', 'dsh-skills-nexus', ''],
        ['add-flags', 'dsh-skills-nexus', 'add', '--n'],
        ['doctor-bare-dashes', 'dsh-skills-nexus', 'doctor', '--'],
        ['shell-values', 'dsh-skills-nexus', 'completions', '--shell', ''],
        ['update-names', 'dsh-skills-nexus', 'update', ''],
        ['rollback-names', 'dsh-skills-nexus', 'rollback', '--json', ''],
        ['rollback-flag', 'dsh-skills-nexus', 'rollback', '--'],
        ['rollback-second', 'dsh-skills-nexus', 'rollback', 'alpha', ''],
        ['remove-yes', 'dsh-skills-nexus', 'remove', '--yes', ''],
        ['remove-second', 'dsh-skills-nexus', 'remove', 'alpha', ''],
        ['update-flag', 'dsh-skills-nexus', 'update', '--x'],
        ['unknown-cmd', 'dsh-skills-nexus', 'nope', ''],
      ],
      stubDir,
    )

    // Candidates are recorded unfiltered (zsh does the filtering itself), so
    // the subcommand case is compared against the router and the rest as the
    // raw argument list compadd was handed - `--` first, since compadd has to
    // be told where its own options end.
    const [subCase, ...rest] = lines
    const [label, items] = subCase!.split('|')
    assert.equal(label, 'sub')
    assert.deepEqual(items!.split(' ').sort(), routed)

    assert.deepEqual(rest, [
      'add-flags|-- --name --ref --subdir --yes --json',
      'doctor-bare-dashes|-- --json --updates --quiet',
      'shell-values|-- bash zsh fish powershell',
      'update-names|alpha beta',
      'rollback-names|alpha beta',
      'rollback-flag|-- --json',
      'rollback-second|',
      // `--yes` is accepted before the names, so it must not consume the slot.
      'remove-yes|alpha beta',
      'remove-second|',
      'update-flag|-- --json',
      'unknown-cmd|',
    ])
  } finally {
    await rm(stubDir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* Templates — executed in a real fish                                */
/* ------------------------------------------------------------------ */

/**
 * Run one fish command line through the emitted template and return the
 * completions, sorted.
 *
 * `complete -C` is fish's own entry point for `what would you offer here` - it
 * evaluates the rules for a given command line and prints the candidates, no
 * terminal involved. The template is sourced from a file; the child runs in an
 * empty directory so fish's implicit file completion has nothing to add.
 */
function runInFish(cmdline: string, stubDir: string, emptyDir: string, templatePath: string): string[] {
  const program = `source '${templatePath}'\ncomplete -C '${cmdline}'\n`
  const res = spawnSync('fish', ['-c', program], {
    encoding: 'utf8',
    cwd: emptyDir,
    env: { ...process.env, PATH: [stubDir, process.env.PATH ?? ''].join(delimiter) },
  })
  const why = res.error ? res.error.message : (res.stderr ?? '')
  assert.equal(res.status, 0, `fish exited with ${String(res.status)}: ${why}`)
  // A description would follow a tab; nothing here has one, but do not let
  // one change the meaning of a candidate.
  return res.stdout
    .split('\n')
    .map((l) => l.split('\t')[0]!.trim())
    .filter((l) => l !== '')
    .sort()
}

test('the emitted fish template completes correctly in a real fish', { skip: !HAS_FISH }, async () => {
  const routed = await routedSubcommands()
  const stubDir = await makeStubDir()
  const emptyDir = join(stubDir, 'cwd')
  await mkdir(emptyDir)
  const templatePath = join(stubDir, 'completions.fish')
  await writeFile(templatePath, fishTemplate)
  try {
    // Positions where no other rule can contribute: exact sets.
    const exact: [string, string, string[]][] = [
      ['sub', 'dsh-skills-nexus ', routed],
      ['sub-prefix-d', 'dsh-skills-nexus d', ['disable', 'doctor']],
      ['add-flag', 'dsh-skills-nexus add --n', ['--name']],
      ['add-bare-dashes', 'dsh-skills-nexus add --', ['--name', '--ref', '--subdir', '--yes', '--json']],
      ['doctor-bare-dashes', 'dsh-skills-nexus doctor --', ['--json', '--quiet', '--updates']],
      ['shell-prefix', 'dsh-skills-nexus completions --shell b', ['bash']],
      ['update-skill', 'dsh-skills-nexus update ', ['alpha', 'beta']],
      ['rollback-skill', 'dsh-skills-nexus rollback ', ['alpha', 'beta']],
      ['rollback-flag', 'dsh-skills-nexus rollback --', ['--json']],
      ['update-flag', 'dsh-skills-nexus update --x', []],
      ['unknown-cmd', 'dsh-skills-nexus nope ', []],
    ]
    for (const [label, cmdline, expected] of exact) {
      assert.deepEqual(runInFish(cmdline, stubDir, emptyDir, templatePath), [...expected].sort(), label)
    }

    // An empty slot is where fish may also list the option name itself, so only
    // the candidates that carry the meaning are pinned.
    for (const [label, cmdline, expected] of [
      ['shell-bare', 'dsh-skills-nexus completions --shell ', [...SUPPORTED_SHELLS]],
      ['remove-yes', 'dsh-skills-nexus remove --yes ', ['alpha', 'beta']],
      ['rollback-json', 'dsh-skills-nexus rollback --json ', ['alpha', 'beta']],
    ] as [string, string, string[]][]) {
      const got = runInFish(cmdline, stubDir, emptyDir, templatePath)
      for (const want of expected)
        assert.ok(got.includes(want), `${label} should offer ${want}, got: ${got.join(' ')}`)
    }

    // Names belong to the first positional only, flags or not.
    for (const [label, cmdline] of [
      ['remove-second', 'dsh-skills-nexus remove alpha '],
      ['rollback-second', 'dsh-skills-nexus rollback alpha '],
      ['remove-yes-second', 'dsh-skills-nexus remove --yes alpha '],
    ] as [string, string][]) {
      const got = runInFish(cmdline, stubDir, emptyDir, templatePath)
      for (const name of ['alpha', 'beta'])
        assert.ok(!got.includes(name), `${label} should not offer ${name}, got: ${got.join(' ')}`)
    }
  } finally {
    await rm(stubDir, { recursive: true, force: true })
  }
})
