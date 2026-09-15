import { stderr } from 'node:process'

/**
 * Minimal, dependency-free terminal progress helpers for the CLI.
 *
 * The only genuinely slow steps in `add` / `update` are single network calls
 * (`git ls-remote`, `git clone`, `git pull`) whose duration is unknown up
 * front, so a fake percentage bar would be dishonest. Instead we render an
 * *indeterminate* spinner with an elapsed-time readout, plus a `[i/N]` batch
 * counter for multi-repo runs.
 *
 * Everything is gated on `stderr.isTTY`:
 *   - On a non-TTY (CI, pipes, tests, `> log`) the spinner is a silent no-op,
 *     so `\r`/ANSI never pollutes captured output and existing tests — which
 *     assert on exit codes and manifest state, not on progress text — stay
 *     green.
 *   - Rendering goes to stderr, keeping stdout reserved for the command's
 *     structured result lines.
 *
 * Only `\r`, erase-line (`\x1b[2K`) and cursor hide/show are used, all of
 * which work on Windows Terminal / conhost (Win10+) as well as POSIX terms,
 * keeping the cross-platform CI matrix safe.
 */

/** Braille spinner frames (a single-cell animation, no width jitter). */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Animation interval in ms — fast enough to feel live, slow enough to read. */
const TICK_MS = 80

/** A running spinner. `stop` is always safe to call, even on a no-op spinner. */
export interface Spinner {
  /** Replace the message shown next to the spinner (e.g. as steps advance). */
  update(message: string): void
  /** Stop animating, erase the spinner line, and restore the cursor. */
  stop(): void
}

const NOOP: Spinner = { update() {}, stop() {} }

/** Current terminal width in columns, falling back to 80 when unknown. */
function terminalColumns(): number {
  const cols = stderr.columns
  return typeof cols === 'number' && cols > 0 ? cols : 80
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
export function clampToWidth(text: string, cols: number): string {
  const budget = Math.floor(cols)
  if (budget <= 0) return ''
  if (text.length <= budget) return text
  return budget === 1 ? '…' : `${text.slice(0, budget - 1)}…`
}

/**
 * Start an indeterminate spinner on stderr showing `<frame> <message>… <n>s`.
 * Returns a no-op spinner when stderr is not a TTY, so callers can wrap a slow
 * operation unconditionally without branching on interactivity themselves.
 */
export function startSpinner(message: string): Spinner {
  if (!stderr.isTTY) return NOOP

  let frame = 0
  let current = message
  const startedAt = Date.now()

  const render = (): void => {
    const secs = Math.round((Date.now() - startedAt) / 1000)
    const glyph = FRAMES[frame++ % FRAMES.length]
    // Reserve 2 cells for the glyph + separating space, then clamp so the whole
    // line stays within the terminal width and can never wrap (see clampToWidth).
    const label = clampToWidth(`${current}… ${secs}s`, terminalColumns() - 2)
    stderr.write(`\r\x1b[2K${glyph} ${label}`)
  }

  stderr.write('\x1b[?25l') // hide cursor
  render()
  const timer = setInterval(render, TICK_MS)
  // Never keep the event loop alive just to animate.
  timer.unref?.()

  let stopped = false
  return {
    update(next: string) {
      current = next
      render()
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      stderr.write('\r\x1b[2K') // erase the spinner line
      stderr.write('\x1b[?25h') // show cursor
    },
  }
}

/**
 * Run `fn` while a spinner animates, guaranteeing the spinner is stopped even
 * if `fn` throws (so a failed clone/pull never leaves a stuck animation).
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  const spinner = startSpinner(message)
  try {
    return await fn()
  } finally {
    spinner.stop()
  }
}

/**
 * Batch-counter prefix: `[3/10] ` when processing more than one item, empty
 * otherwise. Printed to stdout (not the spinner) so scripts and logs also see
 * which item of a multi-repo run is in flight.
 */
export function batchPrefix(index: number, total: number): string {
  return total > 1 ? `[${index}/${total}] ` : ''
}
