/**
 * `enable <name>` / `disable <name>` — toggle catalog visibility by creating
 * or removing symlinks in the official DSH skills root.
 *
 * The actual clone stays in ~/.dsh/skills-nexus/repos/. enable/disable just
 * controls whether symlinks exist in ~/.dsh/skills/ — lightweight and atomic.
 */
export declare function toggle(argv: string[], enabled: boolean): Promise<number>;
//# sourceMappingURL=toggle.d.ts.map