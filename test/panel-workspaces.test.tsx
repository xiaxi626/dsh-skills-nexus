import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NexusPanel, WorkspaceSkillRow } from '../src/client/panel.js'
import type { NexusApi, ProjectFileEntry } from '../src/client/api.js'

/**
 * The registered-workspace block, as far as a *static* render reaches.
 *
 * Same bench as `panel-render.test.tsx`: no DOM, no effects, so the block's
 * three states (`null` before the first click → unavailable → available) cannot
 * be advanced here. What is asserted is the structural contract that the plan
 * pins down: the new block comes **first**, a divider separates it from the
 * untouched manual block, and the row component only ever offers a switch.
 *
 * The interactive half — load workspaces, pick one, flip a switch, watch the
 * directory move — is the real-host acceptance walk in
 * `docs/verify-project-skills.md`.
 */

/**
 * An api whose `list()` never settles: the first render is all there is.
 * Workspace methods are declared so a future effect cannot turn into
 * "undefined is not a function" during render; no assertion depends on them.
 */
function mountApi(): NexusApi {
  const notCalled = (name: string) => (): never => {
    throw new Error(`unexpected api.${name}() during a static render`)
  }
  return {
    list: () => new Promise(() => {}),
    doctor: notCalled('doctor'),
    add: notCalled('add'),
    importPreview: notCalled('importPreview'),
    importPackage: notCalled('importPackage'),
    adopt: notCalled('adopt'),
    remove: notCalled('remove'),
    update: notCalled('update'),
    checkUpdates: notCalled('checkUpdates'),
    switchVersion: notCalled('switchVersion'),
    toggle: notCalled('toggle'),
    job: notCalled('job'),
    cancelJob: notCalled('cancelJob'),
    export: notCalled('export'),
    linkPreview: notCalled('linkPreview'),
    linkLocal: notCalled('linkLocal'),
    projectList: notCalled('projectList'),
    projectLink: notCalled('projectLink'),
    projectRemove: notCalled('projectRemove'),
    projectToggle: notCalled('projectToggle'),
    workspacesList: notCalled('workspacesList'),
    workspaceSkills: notCalled('workspaceSkills'),
    workspaceToggle: notCalled('workspaceToggle'),
  } as unknown as NexusApi
}

test('the registered workspace block sits above the untouched manual folder block', () => {
  const html = renderToStaticMarkup(<NexusPanel api={mountApi()} />)
  const workspaceAt = html.indexOf('registered workspace (.dsh)')
  const folderAt = html.indexOf('aria-label="project root"')
  assert.ok(workspaceAt > 0, 'the workspace block must render')
  assert.ok(folderAt > 0, 'the manual project root input must still render')
  assert.ok(workspaceAt < folderAt, 'the workspace block must come first')
  // A divider — not one merged list — separates the two blocks.
  assert.match(html.slice(workspaceAt, folderAt), /<hr/)
})

test('the workspace block starts from the explicit load-workspaces affordance', () => {
  const html = renderToStaticMarkup(<NexusPanel api={mountApi()} />)
  // The registry is not probed on mount: the first render only offers the
  // click, so a headless host can never be mistaken for an empty registry.
  assert.match(html, /load workspaces/)
  assert.match(html, /only available on the DSH web profile/)
})

test('the manual project folder input and its hint are untouched', () => {
  const html = renderToStaticMarkup(<NexusPanel api={mountApi()} />)
  assert.match(html, /aria-label="project root"/)
  assert.match(html, /does not have to be a registered DSH workspace/)
})

test('WorkspaceSkillRow offers only a switch for an active directory', () => {
  const entry: ProjectFileEntry = {
    name: 'alpha',
    path: 'D:/repo/.dsh/skills/alpha',
    enabled: true,
    skill: {
      name: 'alpha',
      description: 'demo',
      skillFile: 'D:/repo/.dsh/skills/alpha/SKILL.md',
      resourceBase: 'D:/repo/.dsh/skills/alpha',
      valid: true,
    },
  }
  const html = renderToStaticMarkup(
    <WorkspaceSkillRow entry={entry} busy={false} onToggle={() => undefined} />,
  )
  assert.match(html, /label="disable alpha"/)
  assert.match(html, /active dir/)
  assert.doesNotMatch(html, />remove</)
})

test('WorkspaceSkillRow offers enabling for a parked directory', () => {
  const entry: ProjectFileEntry = {
    name: 'beta',
    path: 'D:/repo/.dsh/skills-disabled/beta',
    enabled: false,
    skill: null,
  }
  const html = renderToStaticMarkup(
    <WorkspaceSkillRow entry={entry} busy={false} onToggle={() => undefined} />,
  )
  assert.match(html, /label="enable beta"/)
  assert.match(html, /disabled dir/)
  // No parsed metadata falls back to the directory path.
  assert.match(html, /D:\/repo\/.dsh\/skills-disabled\/beta/)
})

test('WorkspaceSkillRow disables the switch while another move is in flight', () => {
  const entry: ProjectFileEntry = {
    name: 'alpha',
    path: 'D:/repo/.dsh/skills/alpha',
    enabled: true,
    skill: null,
  }
  const html = renderToStaticMarkup(
    <WorkspaceSkillRow entry={entry} busy onToggle={() => undefined} />,
  )
  assert.match(html, /disabled=""/)
})
