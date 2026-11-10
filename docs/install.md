# Installation

Three installation paths — choose the one that matches your needs. All three install the same
`dsh-skills-nexus` CLI; the first two also put nexus into the DSH web plugin layer.

## Path 1: Published npm registry (recommended for most users)

```bash
npm install -g dsh-skills-nexus
```

This pulls from npmjs.com, so no Git dependency is involved — `--allow-git=all` is never needed.
The downside: releases lag behind the latest code on GitHub.

## Path 2: Directly from GitHub (gets you the latest code)

**npm 12+** (Git dependencies are blocked by default):

```bash
npm install -g --allow-git=all github:xiaxi626/dsh-skills-nexus
```

**Older npm** (Git dependencies not blocked):

```bash
npm install -g github:xiaxi626/dsh-skills-nexus
```

> **Why two forms?** npm 12 changed `allow-git` from default-allowed to `none`, so a
> `github:owner/repo` spec now needs explicit permission. Check your version with
> `npm --version`, and the active policy with `npm config get allow-git`.

## Path 3: Register as a DSH plugin (web panel)

This path installs nexus **as a DSH plugin layer** inside your profile and also enables
the web panel. It does **not** put a CLI command on your PATH — you still need one of
the two npm paths above for that.

```bash
dsh plugin --profile web add "github:xiaxi626/dsh-skills-nexus"
```

Replace `web` with the profile name you use. In a **web** DSH session this registers the
Skills Nexus settings panel and its `/skills-nexus/*` HTTP routes; in non-web hosts the
layer stays dormant.

> **The plugin layer is optional.** Skill discovery never depends on it — skills are
> picked up through the symlinks nexus creates in `~/.dsh/skills/` plus the official
> filesystem provider. The global CLI always comes from one of the two npm paths above.

## Troubleshooting `EALLOWGIT`

```text
npm error code EALLOWGIT
npm error Fetching packages of type "git" have been disabled
```

This is npm's Git dependency policy blocking the installation **before download**, not a
missing Nexus installation or a repository build failure. npm 12 changed `allow-git` from
default-allowed to `none`, so a `github:owner/repo` spec is now a blocked Git dependency.

### What this error does NOT mean

- npm did **not** detect malicious code in Nexus
- Nexus is **not** incompatible with npm 12
- You do **not** need to reinstall the DSH plugin or downgrade npm

### How to fix it

Simply re-run the install command with `--allow-git=all` (Path 2 above). The flag applies
only to that invocation — it does not permanently change npm configuration, and it does
not certify the safety of the dependency.

If you hit this repeatedly and want to avoid the flag, use Path 1 (published npm registry)
instead — that path never touches Git dependencies.

### Background: why npm tightened this

The stricter default reduces supply-chain risk: Git dependencies access remote repositories
and may introduce configuration the project does not control. `--allow-git=all` on the
command line is a deliberate, per-installation confirmation that you trust the source.

> Avoid setting `allow-git=all` globally and permanently. `dsh plugin add` uses pnpm, whose
> configuration is independent of npm's — a successful plugin installation does not change
> npm's policy either way.

## Prerequisites

- **Node ≥ 20** (checked at install time)
- `lib/` compiled artifacts are committed with the repo, so there is no `npm run build` step
  — install and use.

## Installed components

After any npm install you get **three independent things**, each removed by a different command:

| What | Where | Removed by |
|---|---|---|
| CLI command | Global npm bin (on your PATH) | `npm uninstall -g dsh-skills-nexus` |
| Skill data (clones + manifest) | `~/.dsh/skills-nexus/` | `dsh-skills-nexus remove '*' --yes` |
| Optional DSH plugin layer | `<profile>/node_modules/` | `dsh plugin --profile web remove dsh-skills-nexus` |

Removing one does **not** remove the others. See [Uninstall](../README_FULL.md#uninstall) for
the full cleanup procedure.

## Still uncertain? Not sure which path fits?

See [nexus vs `dsh plugin` — when to use which](nexus-vs-plugin.md) for the decision guide.
Short version: repo has `SKILL.md` → nexus; repo is a pure plugin (`cordis.patch.yml` /
`dsh.bundle.patch`, no `SKILL.md`) → `dsh plugin`; has both → your choice.
