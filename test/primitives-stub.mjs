/**
 * A minimal stand-in for `@deepseek-ai/dsh-client-ui-primitives`, used **only by
 * the Node test run**.
 *
 * The real package is a browser library: its published `lib/index.js` imports
 * shiki, katex, the micromark/mdast markdown stack, simple-icons and more at the
 * top level, so importing it in Node drags in a dependency tree none of it is
 * installed for. That is not a defect in the package — it is built for the
 * browser bundle, which is exactly where this plugin loads it from (the module
 * table makes it a `require` the host answers).
 *
 * So the test bench substitutes the *shape*: every component renders its
 * children into a harmless element, which is all a static-render assertion can
 * check anyway. What the suite actually verifies about the panel — which branch
 * was taken, which actions exist for which entry, what the meta column says — is
 * decided by this plugin's own logic, not by the primitives' internals.
 *
 * What this deliberately does NOT cover, and what does: the real components are
 * exercised by `npm run build:client` (they are imported and required by name,
 * and the build fails if a name does not exist) and by the real-host smoke test,
 * which is the only place their *appearance* can be judged.
 *
 * Registered by `test/register-css.mjs` through a `resolve` hook, so the
 * redirect is invisible to `src/`.
 */

import { createElement, useState } from 'react'

/** Render children into `tag`; `passProps` forwards attributes when they matter. */
function stub(tag, { passProps = false } = {}) {
  return function Stub(props) {
    const { children, ...rest } = props ?? {}
    return createElement(tag, passProps ? rest : null, children)
  }
}

/** Render nothing — a decorative primitive no assertion depends on. */
function nullStub() {
  return function NullStub() {
    return null
  }
}

/* Controls */
export const Button = stub('button', { passProps: true })
export const Input = stub('input', { passProps: true })
export const Checkbox = stub('input', { passProps: true })
export const Switch = stub('input', { passProps: true })
export const Pill = stub('span')
export const Tag = stub('span')
export const StateDot = stub('span')
export const PathLabel = stub('span')
export const ConnectionIndicator = stub('span')
export const TextShimmer = stub('span')
export const SegmentedControl = stub('div')
export const SegmentedTabs = stub('div')
export const Tooltip = stub('span')
export const Modal = stub('div')
export const HoverCard = stub('div')
export const Menu = stub('div')
export const MenuSurface = stub('div')
export const MenuGroup = stub('div')
export const MenuItemButton = stub('button', { passProps: true })
export const Toast = stub('div')
export const TerminalBlock = stub('pre')
export const CodeBlock = stub('pre')
export const ReadBlock = stub('pre')
export const DiffBlock = stub('pre')
export const SearchBlock = stub('div')
export const WebBlock = stub('div')
export const JsonTree = stub('div')
export const MarkdownText = stub('div')
export const ImageLightbox = stub('div')
export const SettingsForm = stub('div')

/**
 * The real `RiskConfirmation` is a controlled overlay: it renders only when
 * `open`, and its primary action is gated on `acknowledged`. Reproduced here
 * because the panel's removal flow depends on both — a stub that always
 * rendered, or that ignored the acknowledgement, would hide a regression in the
 * gating instead of surfacing it.
 */
export function RiskConfirmation(props) {
  const { open, title, description, acknowledgeLabel, cancelLabel, confirmLabel } = props
  if (open !== true) return null
  return createElement(
    'div',
    { role: 'alertdialog' },
    createElement('strong', null, title),
    createElement('p', null, description),
    createElement('span', null, acknowledgeLabel),
    createElement(
      'button',
      {
        type: 'button',
        'data-confirm': confirmLabel,
        disabled: props.disabled === true || props.acknowledged !== true,
      },
      confirmLabel,
    ),
    createElement('button', { type: 'button' }, cancelLabel),
  )
}

/**
 * The real `DisclosureRow` is a controlled disclosure; the panel owns the open
 * state, so the stub only has to expose the title and render children when open.
 */
export function DisclosureRow(props) {
  return createElement(
    'div',
    null,
    createElement('span', null, props.title),
    props.open === true ? props.children : null,
  )
}

/* Icons — the real set is `Icon*Regular` / `Icon*Medium`; only presence matters. */
export const IconSearchOutlineRegular = stub('svg')
export const IconSearchOutlineMedium = stub('svg')
export const IconRefreshOutlineRegular = stub('svg')
export const IconWarningOutlineRegular = stub('svg')
export const IconWarningTriangleOutlineRegular = stub('svg')
export const IconChevronDownOutlineRegular = stub('svg')
export const IconChevronRightOutlineRegular = stub('svg')
export const IconPlusOutlineRegular = stub('svg')
export const IconTrashOutlineRegular = stub('svg')
export const IconCheckOutlineRegular = stub('svg')
export const IconCloseOutlineRegular = stub('svg')
export const IconBranchOutlineRegular = stub('svg')
export const IconPinOutlineRegular = stub('svg')
export const IconSkillOutlineRegular = stub('svg')
export const IconInfoOutlineRegular = stub('svg')

/* Utilities a panel might reach for. */
export const relativeTime = () => ''
export const fileSizeText = () => ''
export const rankByName = (a, b) => String(a).localeCompare(String(b))
export const writeClipboard = async () => {}
export const languageForPath = () => 'text'
export const useCodeHighlighter = () => undefined
export const useAnchoredPosition = () => ({ top: 0, left: 0 })
export const useAnchoredMaxHeight = () => undefined
export const useDismissOnOutsidePointer = () => {}
export const useModalLayer = nullStub()

/** React is re-exported so a stub-side hook can be composed without a second import. */
export { useState }
