/**
 * Shared search filter for skill entries — the single implementation behind
 * both the CLI `list --filter` and the panel's search box.
 *
 * Matches case-insensitively against three fields:
 *   - `name`  — the management key (e.g. `theme-dark`)
 *   - `url`   — the original spec or git URL the user registered
 *   - `subdir` — the repo-relative skill root (absent = root)
 *
 * Why these three: the panel's `matchesQuery` already searched name + url +
 * subdir, and the CLI `list` table shows all three columns (NAME, SOURCE,
 * SUBDIR). A user typing "trae" expects to see every entry whose origin repo
 * contains "trae" regardless of the local name; a user typing "skills/foo"
 * expects to narrow to one subdir entry. Matching only the name would miss
 * the groupable-source use case; matching only the URL would miss the common
 * case of searching by the skill's local name.
 */

/**
 * The minimum shape `matchesQuery` needs from either side of the app.
 * `SkillEntry` (CLI) and `ListEntry` (panel) both carry these three fields;
 * the union lets one function serve both callers without a shared interface
 * dependency.
 */
type FilterableEntry = { name: string; url?: string; gitUrl?: string; subdir?: string | null }

/**
 * True when `entry` matches `query` — a case-insensitive substring match
 * against name, URL and subdir. An empty or whitespace-only query matches
 * everything (the filter is a no-op).
 *
 * Exported for both the CLI (`list --filter`) and the panel (search box).
 */
export function matchesQuery(entry: FilterableEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  const url = (entry.gitUrl || entry.url || '').toLowerCase()
  return (
    entry.name.toLowerCase().includes(q) ||
    url.includes(q) ||
    (entry.subdir ?? '').toLowerCase().includes(q)
  )
}
