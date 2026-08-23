/**
 * Classify a cloned repo before registering it with nexus.
 *
 * A repo can be:
 *  - a plain SKILL.md repo (no DSH plugin wrapper)
 *  - a SKILL.md repo wrapped by a thin DSH plugin layer
 *  - a pure DSH plugin (no SKILL.md)
 *  - unknown (neither)
 *
 * The distinction lets `add` ask before taking over a wrapped skill repo, and
 * refuse to manage pure DSH plugins through nexus.
 *
 * `markerDir` overrides where DSH plugin markers are looked for — with
 * `--subdir` installs the skill root is a subdirectory, but plugin markers
 * still live at the clone root.
 */
export type RepoKind = {
    kind: 'plain-skill';
    markers: string[];
} | {
    kind: 'wrapped-skill';
    markers: string[];
} | {
    kind: 'dsh-plugin';
    markers: string[];
} | {
    kind: 'unknown';
    markers: string[];
};
/**
 * Detect known DSH plugin markers at the repo root.
 *
 * The official way to make a package an installable DSH profile layer is to
 * ship a `cordis.patch.yml` and/or declare `dsh.bundle.patch` in package.json.
 * Keeping the detection conservative avoids treating arbitrary package.json
 * files as plugin markers.
 */
export declare function detectDshPluginMarkers(dir: string): Promise<string[]>;
/** Classify a cloned repo based on SKILL.md presence and DSH plugin markers. */
export declare function classifyRepo(dir: string, options?: {
    markerDir?: string;
}): Promise<RepoKind>;
//# sourceMappingURL=repo-kind.d.ts.map