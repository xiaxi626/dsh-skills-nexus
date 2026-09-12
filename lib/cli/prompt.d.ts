/**
 * Ask a yes/no question on the terminal.
 *
 * If stdin is not a TTY, return `defaultValue` instead of hanging — so scripts
 * and tests get a deterministic answer without blocking. Shared by `add`
 * (wrapped-repo / large-collection prompts) and `remove` (multi-match guard).
 */
export declare function confirm(question: string, defaultValue: boolean): Promise<boolean>;
//# sourceMappingURL=prompt.d.ts.map