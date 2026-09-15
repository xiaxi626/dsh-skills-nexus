/** A running spinner. `stop` is always safe to call, even on a no-op spinner. */
export interface Spinner {
    /** Replace the message shown next to the spinner (e.g. as steps advance). */
    update(message: string): void;
    /** Stop animating, erase the spinner line, and restore the cursor. */
    stop(): void;
}
/**
 * Clamp a spinner label so the rendered line never exceeds `cols` cells.
 *
 * A *wrapped* spinner is the bug behind the "wall of resolving…" seen in narrow
 * terminals (e.g. 80-col mintty / Git Bash): once the line spills onto a second
 * row, `\r` returns to that **second** row and `\x1b[2K` erases only it, so every
 * tick strands the previous frame's first row in the scrollback. Keeping the
 * label within the width guarantees single-line in-place redraw on any terminal.
 *
 * Exported (pure — no TTY, no I/O) for unit testing.
 */
export declare function clampToWidth(text: string, cols: number): string;
/**
 * Start an indeterminate spinner on stderr showing `<frame> <message>… <n>s`.
 * Returns a no-op spinner when stderr is not a TTY, so callers can wrap a slow
 * operation unconditionally without branching on interactivity themselves.
 */
export declare function startSpinner(message: string): Spinner;
/**
 * Run `fn` while a spinner animates, guaranteeing the spinner is stopped even
 * if `fn` throws (so a failed clone/pull never leaves a stuck animation).
 */
export declare function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T>;
/**
 * Batch-counter prefix: `[3/10] ` when processing more than one item, empty
 * otherwise. Printed to stdout (not the spinner) so scripts and logs also see
 * which item of a multi-repo run is in flight.
 */
export declare function batchPrefix(index: number, total: number): string;
//# sourceMappingURL=progress.d.ts.map