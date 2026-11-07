/**
 * Project-scope skills: links under `<projectRoot>/.dsh/skills/`.
 *
 * The DSH filesystem provider scans that directory at rank 100 — ahead of the
 * user-level root nexus otherwise maintains — so a link placed there shadows a
 * global skill of the same name without any registration step. This module is
 * therefore deliberately stateless: it scans, creates and removes links, and
 * keeps no record beyond the filesystem itself.
 *
 * The ownership rule that makes project scope safe:
 *
 *   - nexus only ever creates a link;
 *   - it only removes something it has proven to be a link (`isLinkAt`);
 *   - a real directory or file the user vendored into the project is reported
 *     and never touched.
 *
 * No manifest entry, clone or copy is involved, so none of the manifest lock,
 * migration or "stale projectRoot" failure modes apply.
 */
import type { OpsIO } from './ops-io.js';
/**
 * A clear refusal for a source directory nexus cannot link, or `undefined`.
 *
 * Windows junctions require a local absolute target: `symlink(..., 'junction')`
 * answers a UNC path (\servershare\…) with a raw `EPERM`, which reads like a
 * permissions problem rather than an unsupported target. The check is confined
 * to win32 because a leading `//` is an ordinary path elsewhere.
 */
export declare function projectSourceError(source: string): string | undefined;
/** One entry found directly under `<projectRoot>/.dsh/skills/`. */
export interface ProjectSkillEntry {
    name: string;
    /** Absolute path of the entry itself. */
    path: string;
    /** `link` = a symlink/junction nexus can manage; `files` = user content. */
    kind: 'link' | 'files';
    /** Resolved (or recovered) link target; `null` for `files` and unrecoverable links. */
    target: string | null;
    /** True when a link's target is missing or is not a directory. */
    dangling: boolean;
}
/**
 * What `planProjectLink` decided for one discovered skill:
 *
 *   - `link`      — nothing at the name yet, a link will be created;
 *   - `replace`   — a link (possibly dangling) already owns the name;
 *   - `unchanged` — a link already points at exactly this directory;
 *   - `collision` — a real directory/file owns the name, or two skills in the
 *                    same scan derive the same name;
 *   - `invalid`   — no DSH-valid name can be derived.
 */
export type ProjectLinkStatus = 'link' | 'replace' | 'unchanged' | 'collision' | 'invalid';
export interface ProjectLinkResult {
    name: string;
    target: string | null;
    status: ProjectLinkStatus;
    /** Set when the entry cannot be (or failed to be) linked. */
    error?: string;
}
export interface ProjectLinkPlan {
    root: string;
    source: string;
    results: ProjectLinkResult[];
}
export interface ProjectLinkSummary {
    linked: number;
    replaced: number;
    unchanged: number;
    failed: number;
}
export type ProjectRemoveStatus = 'removed' | 'not-found' | 'not-a-link';
/** Absolute path of one entry in the project skills root. */
export declare function projectSkillPath(root: string, name: string): string;
/**
 * Scan `<projectRoot>/.dsh/skills/` (one level, like the provider) and
 * classify every entry by what is on disk.
 *
 * A link is `dangling` when its target cannot be resolved or is not a
 * directory. The target string is still reported whenever `readlink` can
 * recover it, so a link whose directory was deleted remains diagnosable rather
 * than anonymous. Missing/unreadable roots list as empty — a project with no
 * project skills is normal, not an error.
 */
export declare function listProjectSkills(root: string): Promise<ProjectSkillEntry[]>;
/**
 * Build a link plan without touching the filesystem.
 *
 * The first skill that claims a name wins; a second one deriving the same name
 * in the same scan is reported as a collision instead of silently overwriting
 * the first (the two skills have different targets, so no order-independent
 * answer exists). An existing link is `replace` unless it already points at
 * the same directory; user content is always `collision`.
 */
export declare function planProjectLink(root: string, sourceDir: string): Promise<ProjectLinkPlan>;
/**
 * Execute a plan: create one link per `link`/`replace` result.
 *
 * Each name is written under its own cross-process lock so a CLI invocation and
 * a panel request for the same project + skill cannot interleave. The lock key
 * mixes a hash of the canonical project root with the skill name, because two
 * projects may legitimately link the same skill name at the same time. A
 * failure is recorded on its result instead of aborting the batch — the caller
 * reports per-item outcomes and derives the exit code from them.
 */
export declare function applyProjectLink(plan: ProjectLinkPlan, io: OpsIO): Promise<ProjectLinkPlan>;
/** Count a plan's outcomes (a result that carries an error counts as failed). */
export declare function summarizeProjectLink(plan: ProjectLinkPlan): ProjectLinkSummary;
/**
 * Remove the link called `name` from the project skills root.
 *
 * Only a proven link is removed. A real directory or file returns `not-a-link`
 * and is left byte-for-byte untouched — the whole safety argument of project
 * scope, so `unlinkAt`'s refusal is surfaced rather than worked around.
 */
export declare function removeProjectLink(root: string, name: string): Promise<ProjectRemoveStatus>;
/** Every dangling link in the project skills root (doctor's project check). */
export declare function projectDanglingLinks(root: string): Promise<Array<{
    name: string;
    target: string | null;
}>>;
//# sourceMappingURL=project.d.ts.map