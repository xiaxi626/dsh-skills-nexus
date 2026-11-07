import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cliIO } from '../../ops-io.js'
import type { OpsIO } from '../../ops-io.js'
import { parseLinkArgs } from '../args.js'
import type { LinkCLIOptions } from '../args.js'
import { planLinkLocal, linkLocal } from '../../external.js'
import type { LinkPlan, LinkResult } from '../../external.js'
import {
  applyProjectLink,
  planProjectLink,
  projectSourceError,
  summarizeProjectLink,
} from '../../project.js'
import { projectSkillsDir } from '../../paths.js'
import { resolveProjectScope } from '../project-scope.js'
import { emitJson } from '../json-io.js'

/**
 * `link <source>` — register external skills as manifest entries and create
 * symlinks in the official DSH skills root.
 *
 * 按来源配置扫描 trae-cn / trae 的用户技能，创建 ownership: 'external'
 * 条目，并以 groupPath 派生的扁平名称链接到 `~/.dsh/skills/`。
 *
 * Semantics mirror `import`: source is required, `--dry-run` previews, without
 * it the command executes. `--json` emits a structured report.
 *
 * Exit codes: 0 = done, 1 = error, 2 = usage error.
 */
export async function link(argv: string[], io: OpsIO = cliIO): Promise<number> {
  let opts
  try {
    opts = parseLinkArgs(argv)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    io.error(`error: ${message}\n`)
    return 2
  }

  const linkOpts = {
    ...(opts.dirOverride !== undefined ? { dirOverride: opts.dirOverride } : {}),
    ...(opts.traeCnDir !== undefined ? { traeCnDir: opts.traeCnDir } : {}),
    ...(opts.group !== undefined ? { group: opts.group } : {}),
    ...(opts.force ? { force: true } : {}),
  }

  // Directory-style project link: no source registry, no manifest write, and
  // the links land under <project>/.dsh/skills.
  if (opts.project) return linkProject(opts, io)

  if (opts.dryRun) {
    // Preview mode: plan only, print what would happen.
    let plan: LinkPlan
    try {
      plan = await planLinkLocal(opts.source, linkOpts)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      io.error(`error: ${message}\n`)
      return 1
    }

    if (opts.json) {
      io.emit(JSON.stringify({ version: 1, plan }, null, 2) + '\n')
      return 0
    }

    if (plan.entries.length === 0 && plan.conflicts.length === 0) {
      io.emit(`No skills found under the ${opts.source} root.\n`)
      return 0
    }

    if (plan.conflicts.length > 0) {
      io.emit(`The following entries already exist (pass --force to overwrite):\n`)
      for (const name of plan.conflicts) {
        io.emit(`  - ${name}\n`)
      }
    }

    if (plan.entries.length > 0) {
      io.emit(`Would create ${plan.entries.length} entry/entries:\n`)
      for (const entry of plan.entries) {
        const group = entry.groupPath.join('/')
        io.emit(`  ${entry.name}  (${group})  →  ${entry.externalDir}\n`)
      }
    }

    return 0
  }

  // Execute mode: plan + create entries + symlinks.
  let result: { plan: LinkPlan; result: LinkResult }
  try {
    result = await linkLocal(opts.source, linkOpts, io)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    io.error(`error: ${message}\n`)
    return 1
  }

  if (opts.json) {
    io.emit(JSON.stringify({ version: 1, ...result }, null, 2) + '\n')
    return 0
  }

  const { plan, result: res } = result

  if (res.added.length > 0) {
    io.emit(`Linked ${res.added.length} skill(s) from ${opts.source}:\n`)
    for (const name of res.added) {
      const entry = plan.entries.find((e) => e.name === name)
      const group = entry ? entry.groupPath.join('/') : name
      io.emit(`  ${name}  (${group})\n`)
    }
  }

  if (res.skipped.length > 0) {
    io.emit(`Skipped ${res.skipped.length} entry/entries (already exist):\n`)
    for (const name of res.skipped) {
      io.emit(`  - ${name}\n`)
    }
  }

  if (res.added.length === 0 && res.skipped.length === 0) {
    io.emit(`No skills found under the ${opts.source} root.\n`)
  }

  return 0
}

/**
 * `link --project <dir>`: link every skill discovered in `<dir>` into
 * `<project>/.dsh/skills`.
 *
 * Same directory scan as the global channel (`previewSkills`), but the
 * destination and the bookkeeping differ: this writes a link and nothing else —
 * no manifest entry, no clone, no name-collision state to remember. Link names
 * come from the skill's directory (see `planProjectLink`), because that is what
 * the DSH provider keys a project skill on.
 */
async function linkProject(opts: LinkCLIOptions, io: OpsIO): Promise<number> {
  const scope = await resolveProjectScope(opts.projectRoot)
  if ('error' in scope) {
    io.error(`error: ${scope.error}\n`)
    return 1
  }

  const source = resolve(opts.source)
  const unsupported = projectSourceError(source)
  if (unsupported !== undefined) {
    io.error(`error: ${unsupported}\n`)
    return 1
  }
  try {
    if (!(await stat(source)).isDirectory()) throw new Error('not a directory')
  } catch {
    io.error(`error: no source directory at "${source}"\n`)
    return 1
  }

  const plan = await planProjectLink(scope.root, source)
  if (!opts.dryRun) await applyProjectLink(plan, io)
  const summary = summarizeProjectLink(plan)
  const dest = projectSkillsDir(scope.root)

  if (opts.json) {
    emitJson(io, {
      version: 1,
      projectRoot: scope.root,
      source: plan.source,
      results: plan.results,
      summary,
    })
    return summary.failed > 0 ? 1 : 0
  }

  if (plan.results.length === 0) {
    io.emit(`No skills found under ${source}.\n`)
    return 0
  }

  io.emit(
    opts.dryRun
      ? `Would link ${summary.linked} skill(s) into ${dest}` +
          `${summary.replaced > 0 ? `, replacing ${summary.replaced}` : ''}:
`
      : `Linked ${summary.linked} skill(s) into ${dest}` +
          `${summary.replaced > 0 ? `, replacing ${summary.replaced}` : ''}:
`,
  )
  for (const result of plan.results) {
    if (result.status === 'link') io.emit(`  + ${result.name}  →  ${result.target ?? '?'}\n`)
    else if (result.status === 'replace') io.emit(`  ~ ${result.name}  →  ${result.target ?? '?'}\n`)
    else if (result.status === 'unchanged') io.emit(`  = ${result.name}  →  ${result.target ?? '?'} (already linked)\n`)
    else io.error(`  ✗ ${result.name}: ${result.error ?? result.status}\n`)
  }
  if (summary.failed > 0) {
    io.error(`${summary.failed} entr${summary.failed === 1 ? 'y' : 'ies'} could not be linked.\n`)
    return 1
  }
  return 0
}
