/**
 * Core domain types for dsh-skills-nexus.
 *
 * After the refactor, nexus is a pure CLI tool that manages git clones and
 * creates symlinks in the official DSH skills root. No custom provider means
 * no DSH SDK contract types are needed.
 */
/** One registered GitHub skill repo. */
export interface SkillEntry {
    /** Management key + symlink directory name. Always valid kebab-case. */
    name: string;
    /** Original spec the user passed, e.g. `github:owner/repo#main`. */
    url: string;
    /** Resolved git URL used for clone/fetch. */
    gitUrl: string;
    /** Branch / tag / commit. */
    ref: string;
    /**
     * Resolved commit SHA of the current checkout — a lightweight lock
     * ("lockfile-lite"). Recorded at `add` time and re-stamped by `update`, so
     * the manifest always knows the exact installed version even when `ref` is
     * a moving branch.
     */
    commit?: string;
    /** 显式按 package commit 锁定；缺失按 false 解释，不从 HEAD 推导。 */
    locked?: boolean;
    /**
     * Path of the skill root *inside* the clone, e.g. `skills/foo` — set when
     * the repo was installed piecemeal via `--subdir`. Absent = the clone root
     * is the skill root. Always a repo-relative path (no `..`, no leading `/`).
     */
    subdir?: string;
    /**
     * Who owns the directory this entry exposes. Absent = `managed`: nexus
     * created `repos/<path>` and `remove` may delete it. `external` = the entry
     * only links a directory the user owns (a `--link-only` adoption): `remove`
     * deletes the links and the manifest entry but never that directory, and
     * every git-bound path refuses the entry — an external entry records no
     * gitUrl/ref/commit, so it has no history to fetch, update or switch.
     */
    ownership?: 'managed' | 'external';
    /** Directory name under <repos>/ holding the cloned repo. */
    path: string;
    /** ISO timestamp of when the entry was added. */
    addedAt: string;
    /** ISO timestamp of the last successful `git pull`. */
    updatedAt?: string;
    /** External 条目指向的技能根目录绝对路径（仅 ownership='external' 时有值）。 */
    externalDir?: string;
    /** 分层组路径，如 ['trae-cn','skills','brainstorming']。 */
    groupPath?: string[];
    /**
     * 用户显式排除的链接名集合（per-skill disable 记录的**意图**）。缺失 = 空集，
     * 旧 manifest 零迁移。与「enabled 不落盘、由链接存在反推」的不变量正交：
     * excluded 不参与 enabled 推导，enabled 也不反写 excluded；它只约束重建
     * （enable / update / switch-version / HTTP toggle）不得复活被排除的技能。
     * 以链接名为键：上游改名后留下的 stale 名无害（匹配不到任何候选链接）。
     */
    excluded?: string[];
}
/** Persistent state backend for the CLI. */
export interface Manifest {
    version: 1;
    skills: SkillEntry[];
}
//# sourceMappingURL=types.d.ts.map