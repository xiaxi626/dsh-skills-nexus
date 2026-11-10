# dsh-skills-nexus

<p align="center">
  <img src="docs/assets/banner.svg" alt="dsh-skills-nexus — every skill, one place, every machine" width="1200"/>
</p>

<p align="center">
  <img src="https://github.com/xiaxi626/dsh-skills-nexus/actions/workflows/ci.yml/badge.svg" alt="CI"/>
  <img src="https://img.shields.io/npm/v/dsh-skills-nexus" alt="NPM Version"/>
  <img src="https://img.shields.io/npm/dt/dsh-skills-nexus" alt="NPM Downloads"/>
  <img src="https://www.dsh.so/badge/dsh-skills-nexus.svg" alt="dsh.so risk"/>
  <img src="https://dsh-plugin.org/badges/listed.svg" alt="Listed on dsh-plugin.org"/>
  <img src="https://img.shields.io/github/license/xiaxi626/dsh-skills-nexus" alt="License"/>
</p>

<p align="center">
  <strong>English</strong> | <a href="README_CN.md">中文</a>
</p>

**Skill lifecycle manager for DeepSeek Harness (DSH).** Register any git-hosted `SKILL.md` repo, link external skill directories from other agent clients, pack skills for cross-machine transfer, or manage everything from the DSH web panel — all through one CLI.

dsh-skills-nexus is a **community-maintained** DeepSeek Harness plugin, not an official DeepSeek AI product.

## 3-Minute Quick Start

Pick one skill repo and get it into DSH:

```bash
# 1. Install
npm install -g dsh-skills-nexus

# 2. Add a skill repo
dsh-skills-nexus add github:owner/repo

# 3. Done — skills are picked up by the DSH filesystem provider automatically
```

That's it. For the three installation paths (npm registry, GitHub direct, or DSH plugin layer), npm 12 `EALLOWGIT` troubleshooting, and prerequisites — see [Installation Guide](docs/install.md).

## What You Can Do

| Want to… | Run… |
|---|---|
| Add a skill from any git host | `dsh-skills-nexus add github:owner/repo` |
| Pin to a branch / tag / commit | `dsh-skills-nexus add github:owner/repo#dev` |
| Install one subdirectory from a collection repo | `dsh-skills-nexus add github:owner/repo --subdir skills/foo` |
| Link skills already installed in Trae / Qoder / CodeBuddy… | `dsh-skills-nexus link trae-cn` (or `trae`, `qoder`, `codebuddy`, `workbuddy`, `kimi-code`, `cursor`, `claude-code`, …) |
| List everything with status | `dsh-skills-nexus list` |
| Batch enable/disable by group | `dsh-skills-nexus enable --group trae-cn` |
| Move all skills to another machine | `dsh-skills-nexus export --all -o migrate.zip` → `dsh-skills-nexus import migrate.zip` |
| Health check with exit codes | `dsh-skills-nexus doctor` |
| Watch it all in the web panel | Register as DSH plugin → Settings → Skills Nexus |

## Web Panel

When registered as a DSH plugin (`dsh plugin add`), the Settings page gets a **Skills Nexus** section with a full UI: browse entry cards, toggle groups, add skills by URL, import packages, run health checks, watch long operations stream progress.

See the [full panel description](README_FULL.md#web-panel-optional-plugin-side) for every action the UI supports.

## How It Works

<p align="center">
  <img src="docs/assets/workflow.svg" alt="A git repo is cloned into the Nexus manifest, symlinked into ~/.dsh/skills, and picked up by the DSH provider; CLI and web panel drive the same manifest" width="720"/>
</p>

CLI and Web Panel drive the same manifest, the same clones, and the same cross-process file locks. Mix both freely — an operation one side is working on shows as `busy` / `locked` on the other.

<details>
<summary>How the link channel works</summary>

`link trae-cn` / `link trae` / `link qoder` etc. creates **external entries** that symlink to directories you already own (`~/.trae-cn/skills/`, `~/.trae/skills/`, …). Nexus never clones, updates, or deletes those directories — `remove` only deletes the link and manifest entry.

Each client is an independent namespace. One skill installed in two clients becomes two entries, never shadowing each other. The default root can be overridden with `--source-dir`.

</details>

## This or `dsh plugin add`?

| Installs… | Requires `dsh.bundle.patch`? | Command |
|---|---|---|
| A pure SKILL.md content repo | **No** | `dsh-skills-nexus add github:owner/any-skill` |
| A real DSH plugin with Cordis wrapper | Yes | `dsh plugin add github:owner/dsh-skills-nexus` |

If your repo has both, your choice — nexus for managing the content, `dsh plugin` for managing the code wrapper. [Full decision guide](docs/nexus-vs-plugin.md).

## Roadmap & Known Limitations

- **v0.10.x**: Project-scope skills are experimental — CLI interaction may shift. Global skills are stable.
- **v0.11**: Opt-in anonymous usage statistics, so we know how many people actually use this.
- **No first-run telemetry**: nothing is sent by default — the project is silent unless you opt in.
- **Skill content repos only**: this is *not* a replacement for `dsh plugin add` of real Cordis plugins.

Issues welcome — [open one blank](https://github.com/xiaxi626/dsh-skills-nexus/issues/new) or pick a [template](https://github.com/xiaxi626/dsh-skills-nexus/issues/new/choose).

## Documentation Index

The full reference lives in `README_FULL.md` — every flag, every edge case, every gotcha. Here's where to jump:

| I want to… | Read… |
|---|---|
| Install it | [Installation Guide](docs/install.md) |
| Understand every `dsh-skills-nexus` subcommand | [Usage Reference](README_FULL.md#usage) |
| All supported `link` sources (Trae / Qoder / CodeBuddy / …) | [Supported external sources](README_FULL.md#supported-external-sources-link) |
| Use skills scoped to a project folder | [Project skills](README_FULL.md#project-skills) |
| Move skills between machines | [Export / Import / Adopt](README_FULL.md#moving-skills-to-another-machine-export--import) |
| Use `--json` for scripting | [Options and --json](README_FULL.md#options---json-and-add-checks) |
| What the Web Panel can do | [Web Panel](README_FULL.md#web-panel-optional-plugin-side) |
| Uninstall completely | [Uninstall](README_FULL.md#uninstall) |
| Test locally without GitHub or npm | [Local testing steps](README_FULL.md#local-testing-steps) |
| Architecture, source discovery, sparse checkout | [Architecture](docs/ARCHITECTURE.md) |
| Build a tool on top of nexus | [Building on nexus](docs/build-on-nexus.md) |
| Nexus vs `dsh plugin` — which one to pick | [nexus vs plugin](docs/nexus-vs-plugin.md) |
| Subdir design trade-offs | [Subdir design](docs/subdir-design.md) |

Community verification walkthroughs: [link sources](docs/verify-link-sources.md) · [project skills](docs/verify-project-skills.md) · [version lock](docs/verify-version-lock.md) · [import/export](docs/verify-import-export.md) · [doctor](docs/verify-doctor.md) · [rollback](docs/verify-rollback.md) · [group operations](docs/verify-group-operations.md) · [completions](docs/verify-completions.md) · [purge](docs/verify-purge.md) · [update pipeline](docs/verify-plugin-install.md) · [switch-version](docs/verify-switch-version.md) · [add/update JSON](docs/verify-version-lock.md)

## Uninstall

Three independent things to clean up — each uses a different command. See [Uninstall](README_FULL.md#uninstall) for the annotated procedure.

```bash
dsh-skills-nexus remove '*' --yes          # 1. Remove all skills (data)
dsh plugin --profile web remove dsh-skills-nexus   # 2. Optional plugin layer
npm uninstall -g dsh-skills-nexus           # 3. Global CLI
```

## License

MIT.
