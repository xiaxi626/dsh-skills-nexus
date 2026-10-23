# Verifying local source links

[简体中文](verify-link-sources.zh-CN.md)

> **Shell warning:** the `bash` blocks below are for Windows Git Bash or Linux/macOS Bash, not PowerShell/cmd. Open a terminal at this checkout's root and run each block as a whole. The scripts do not change directories, perform Git writes, or require a global `npm link`.

This guide verifies [channel E](sources-and-packages.md#channel-e-external-reference-link) for the currently enabled sources — at the time of writing, `trae-cn` and `trae` — plus root overrides and the panel workflow. The enabled set is driven by `SOURCE_CONFIGS` in `src/external.ts`; when a new source is added, update the contract table and walkthrough coverage accordingly. The CLI walkthrough runs the compiled `lib/cli/index.js` with isolated temporary state. Panel acceptance requires a separate test host; CLI success does not establish UI integration success.

## Prerequisites and the two builds

- Project dependencies are installed. The CLI supports Node.js >= 20; Node.js 24 is recommended for this guide including the client build, to meet the installed `tsdown` runtime requirements.
- On Windows use Git Bash. Link checks use `realpath`, covering Windows junctions and Unix symlinks.
- `npm run build` compiles only the server/CLI. `npm run build:client` separately generates `lib/client.js`, its source map, and declarations under `lib/client-types/`. Running only the former does not refresh the panel.

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

Every command should exit 0. To check committed artifact freshness, run `git diff --exit-code -- lib/`. Investigate any difference and rebuild; do not hand-edit generated files or automatically discard pre-existing workspace changes.

## Automated regression tests

```bash
(
  set -e
  node -e "require('node:assert/strict').equal(require('./package.json').name, 'dsh-skills-nexus')"
  node --import tsx --import ./test/register-css.mjs --test \
    test/external-link.test.ts test/cli-link.test.ts test/args.test.ts \
    test/api.test.ts test/client-api.test.ts \
    test/completions.test.ts test/panel-render.test.tsx
)
```

| Test file | Coverage |
|---|---|
| `external-link.test.ts` | Both configurations, environment variables, overrides without fallback, candidate-root ordering, directory deduplication and first-root wins for management names, one-level scan boundaries |
| `cli-link.test.ts` / `args.test.ts` | Preview/execution, JSON, conflicts and force, groups, new/legacy flags and empty-value rejection |
| `api.test.ts` / `client-api.test.ts` | `sourceDir` forwarding for preview/confirmed execution, legacy `traeCnDir`, error responses |
| `completions.test.ts` | New and legacy root flags in all four link branches; actual completion in installed shells |
| `panel-render.test.tsx` | Two enabled buttons, four disabled placeholders, directory input; static rendering only, no simulated clicks |

Before release also run `npm test` and `npm run test:local-source`. Record missing-shell skips separately, not as passes. Focused tests do not replace the full suite or remote cross-platform CI.

## Isolated CLI walkthrough

The table defines the contract; do not create or modify real user directories to test defaults.

| Source | Default scan location | Environment variable |
|---|---|---|
| `trae-cn` | `~/.trae-cn/skills/` | `TRAE_CN_DIR` |
| `trae` | `~/.trae/skills/` | `TRAE_DIR` |

The table reflects the current `SOURCE_CONFIGS`. When a new source is registered, extend the table and the walkthrough coverage.

Precedence: `--source-dir` > `--trae-cn-dir` (legacy alias) > selected source's environment variable > default root. Pass the **root**, not its `skills/` child. An invalid override fails without fallback. The core tests above cover default resolution and multiple candidate roots; the walkthrough below scans only temporary directories.

Run the following block as a whole. Node drives the real compiled CLI, explicitly setting `DSH_HOME`, `DSH_SKILLS_NEXUS_HOME`, and both source environment variables for every child process without changing your terminal environment. A `finally` block cleans the generated directory on success or assertion failure. If forcibly terminated, clean only the printed `fixture:` path.

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
const roots = Object.fromEntries(['trae', 'trae-cn', 'alias', 'override'].map(k => [k, join(base, k)]))
const env = {
  ...process.env,
  DSH_HOME: join(base, 'home'),
  DSH_SKILLS_NEXUS_HOME: join(base, 'nexus'),
  TRAE_DIR: roots.trae,
  TRAE_CN_DIR: roots['trae-cn'],
}
const md = '---\nname: demo\ndescription: isolated link verification\n---\nBody\n'
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

Pass criteria: five `PASS` lines, one `cleaned:` line, and exit 0. Cleanup alone is not success: it also runs after failed assertions. Unlinking and deleting the fixture are separate operations: first prove that `remove --group` preserves the source files, then let the script delete only the temporary files it created.

## Real-host panel acceptance (manual)

### Prepare a dedicated environment

Do not execute these actions on your daily host. Create a separate fixture using the block below. It remains available for the host process and must be cleaned afterward as described below.

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

1. Save the output. In a **new test terminal**, set the four printed environment variables for the DSH process you are about to start, not in permanent system settings. Environment changes made to a CLI child do not affect an already-running host.
2. Follow only the overlay/host-start sections of the [README local testing steps](../README.md#local-testing-steps) to load this checkout's `lib/index.js`; do not run their real-directory skill installation examples. Use a dedicated test-host configuration and an unused port; do not overwrite an existing overlay or alter your daily profile. DSH initialization may require its own dependencies/configuration and is outside the offline CLI walkthrough.
3. Complete both builds, cold-start the test host, and refresh the browser to load the current `lib/client.js`. Confirm the Nexus list is empty. If daily entries appear, stop and check both DSH path variables; **do not link or remove anything**.
4. Open Skills Nexus in settings and expand `link local skills`. Filter browser Network requests by `/skills-nexus/link`. Paths refer to the **server filesystem**, not the browser machine.

### Actions and expected results

| Action | Expected UI / request |
|---|---|
| Inspect source buttons | Trae CN and Trae enabled; Claude Code, WorkBuddy, Qoder, Qoder CN disabled |
| Leave the input empty and click Trae | `source: "trae"`, `confirm: false`, no `sourceDir`; preview `trae.skills.panel-demo`, registered list still empty |
| Click `link` after preview | `source: "trae"`, `confirm: true`; acceptance 202, external entry appears after the job finishes |
| Remove the newly created Trae group | Confirm removal; entry disappears while `TRAE_DIR/skills/panel-demo/SKILL.md` remains |
| Enter the printed `sourceDir`, preview Trae and execute | Both requests carry the same `sourceDir`; preview/entry targets `custom/skills/panel-demo` |
| Preview Trae CN without executing | `source: "trae-cn"`, retains the entered `sourceDir`; does not fall back to Trae |
| Edit the path while a preview exists | Old preview and its `link` action disappear; another preview is required |
| Enter `missingDir` and click a source | Real HTTP response is 400 with `error: "not-found"`; error is shown without a stale execution button; exact UI wording is not asserted |

HTTP with omitted `confirm` or `false` is preview-only; the client explicitly sends `false`. `sourceDir` takes precedence over legacy `traeCnDir`. Duplicate entries appear as preview conflicts. The panel has no force control; the CLI walkthrough verifies `--force`.

### Cleanup and coverage boundaries

- Remove the groups created here from the test panel and confirm. If using the CLI instead, first set the same `DSH_HOME` and `DSH_SKILLS_NEXUS_HOME` as the test host, then run `remove --group trae --yes` only if that group exists. Also remove `trae-cn` if you executed it yourself. Verify the list is empty and source files still exist before cleanup.
- Stop the test host and close the test terminal to discard process-level environment settings. Delete only the printed `fixtureRoot` and an overlay specifically created for this check. Do not delete pre-existing overlays, profiles, `~/.trae`, or `~/.trae-cn`. If reusing an existing overlay, stop the temporary patch process without deleting the file.
- `panel-render.test.tsx` checks only static rendering. Browser checks using the real client bundle with in-memory HTTP / UI stubs verify interaction wiring, not real-host component appearance, routing, or skill discovery.
- Feature development included isolated browser verification; real-host acceptance and the remote CI matrix are not included in that passing result. After following this guide, record Node/OS, command exit codes, pass/skip counts, and the panel actions actually verified.
