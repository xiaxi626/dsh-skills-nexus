/**
 * Core domain types for dsh-skills-nexus.
 *
 * The DSH SDK types (`SkillCandidate` / `SkillDefinition` / `Context`) live in
 * `@deepseek-ai/dsh-skill` and `@deepseek-ai/cordis`. To keep this project
 * reviewable and independently typecheckable, we mirror them here as structural
 * types. TypeScript structural compatibility means the compiled output still
 * satisfies the real SDK at runtime — drop-in compatible.
 */

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

/** One registered GitHub skill repo. */
export interface SkillEntry {
  /** Management key + default skill name. Kebab-case recommended. */
  name: string
  /** Original spec the user passed, e.g. `github:owner/repo#main`. */
  url: string
  /** Resolved git URL used for clone/fetch. */
  gitUrl: string
  /** Branch / tag / commit. */
  ref: string
  /**
   * Resolved commit SHA of the current checkout — a lightweight lock
   * ("lockfile-lite"). Recorded at `add` time and re-stamped by `update`, so
   * the manifest always knows the exact installed version even when `ref` is
   * a moving branch. Absent for entries added before this field existed.
   */
  commit?: string
  /** Directory name under <skills>/ holding the cloned repo. */
  path: string
  /** Whether this skill is exposed to the DSH catalog. */
  enabled: boolean
  /** ISO timestamp of when the entry was added. */
  addedAt: string
  /** ISO timestamp of the last successful `git pull`. */
  updatedAt?: string
}

/** Persistent state backend shared between the CLI (writer) and provider (reader). */
export interface Manifest {
  version: 1
  skills: SkillEntry[]
}

/* ------------------------------------------------------------------ */
/* DSH skill contract (mirrors @deepseek-ai/dsh-skill)                 */
/* ------------------------------------------------------------------ */

export interface ResourceBase {
  kind: 'directory'
  path: string
}

export interface SkillInvocation {
  modelInvocable: boolean
  userInvocable: boolean
}

/**
 * A skill surfaced to the model-facing catalog. `list()` returns an array of
 * these — which is why one provider can carry many skills.
 */
export interface SkillCandidate {
  name: string
  description: string
  invocation: SkillInvocation
  provider: string
  source: string
  resourceBase: ResourceBase
  rank: number
  locator: string
}

/** Full skill content delivered after the model selects a candidate. */
export interface SkillDefinition {
  name: string
  description: string
  invocation: SkillInvocation
  provider: string
  source: string
  resourceBase: ResourceBase
  content: string
}

/** Provider contract DSH calls. `list()` for the catalog, `get(name)` on demand. */
export interface SkillProvider {
  name: string
  list(): Promise<SkillCandidate[]>
  get(name: string): Promise<SkillDefinition>
}

/** Minimal Context seam used by the plugin entry. The real cordis Context is wider. */
export interface NexusContext {
  skills: {
    registerProvider(factory: () => SkillProvider): void
  }
}
