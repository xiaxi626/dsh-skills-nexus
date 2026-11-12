import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createNexusRoutes } from '../src/http/routes.js'
import type { RouteRequest, RouteResponse } from '../src/http/types.js'

async function makeProject(): Promise<string> {
  const root = join(tmpdir(), 'nexus-wsroute-')
  await mkdir(root, { recursive: true })
  await mkdir(join(root, '.dsh', 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, '.dsh', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n\n# alpha\n')
  return root
}

class FakeRes implements RouteResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string>): unknown {
    this.status = status
    this.headers = headers
    return undefined
  }
  end(body?: string | Buffer): unknown {
    this.body = body ? (typeof body === 'string' ? body : body.toString('utf8')) : ''
    return undefined
  }
  json(body: unknown): void {
    this.writeHead(200, { 'content-type': 'application/json' })
    this.end(JSON.stringify(body))
  }
}

function makeReq(path: string, body?: unknown, method = 'GET'): RouteRequest {
  const buf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0)
  const qIdx = path.indexOf('?')
  const query = qIdx === -1 ? '' : path.slice(qIdx + 1)
  return {
    method,
    url: path, // Node IncomingMessage.req.url is a raw string (may include query)
    query: Object.fromEntries(new URLSearchParams(query).entries()),
    body: buf,
    headers: body ? { 'content-type': 'application/json' } : {},
    on(event: string, cb: (chunk?: Buffer | Error) => void) {
      if (event === 'data' && buf.length > 0) cb(buf)
      else if (event === 'end') cb()
      else if (event === 'error') cb(undefined as any)
      return this as any
    },
  } as any
}

function registryFor(path: string) {
  return { list: () => [{ id: 'ws-1', path, title: 'Test' }] }
}

async function runRoute(path: string, body?: unknown, deps: { workspaces?: () => unknown } = {}, method = 'GET'): Promise<FakeRes> {
  const routePath = path.split('?')[0]!
  const routes = createNexusRoutes(deps as any)
  const spec = routes.find((r) => r.path === routePath)
  assert.ok(spec, `route ${routePath} not found (available: ${routes.map((r) => r.path).join(',')})`)
  const res = new FakeRes()
  await spec!.handler(makeReq(path, body, method), res)
  return res
}

test('/workspaces/list returns available:false when no registry', async () => {
  const res = await runRoute('/skills-nexus/workspaces/list')
  assert.equal(res.status, 200)
  const j = JSON.parse(res.body)
  assert.equal(j.data.available, false)
  assert.deepEqual(j.data.items, [])
})

test('/workspaces/list returns rows when registry is available', async () => {
  const root = await makeProject()
  try {
    const res = await runRoute('/skills-nexus/workspaces/list', undefined, {
      workspaces: () => registryFor(root),
    })
    assert.equal(res.status, 200)
    const j = JSON.parse(res.body)
    assert.equal(j.data.available, true)
    assert.equal(j.data.items.length, 1)
    assert.equal(j.data.items[0]!.path, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('/workspace/skills returns 503 when registry is unavailable', async () => {
  const res = await runRoute('/skills-nexus/workspace/skills?workspace=C:/does/not/exist')
  assert.equal(res.status, 503)
  assert.equal(JSON.parse(res.body).error, 'workspace-unavailable')
})

test('/workspace/skills with unregistered workspace returns 400', async () => {
  const res = await runRoute('/skills-nexus/workspace/skills?workspace=C:/does/not/exist', undefined, {
    workspaces: () => ({ list: () => [] }),
  })
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error, 'workspace-unregistered')
})

test('/workspace/toggle rejects invalid names', async () => {
  const root = await makeProject()
  try {
    const deps = { workspaces: () => registryFor(root) }
    const res = await runRoute(
      '/skills-nexus/workspace/toggle',
      { workspace: root, name: '../bad', enabled: false },
      deps,
      'POST',
    )
    assert.equal(res.status, 400)
    assert.equal(JSON.parse(res.body).error, 'invalid-name')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('/workspace/toggle disables a real directory via the workspace route', async () => {
  const root = await makeProject()
  try {
    const deps = { workspaces: () => registryFor(root) }
    const disable = await runRoute(
      '/skills-nexus/workspace/toggle',
      { workspace: root, name: 'alpha', enabled: false },
      deps,
      'POST',
    )
    assert.equal(disable.status, 200)
    const j = JSON.parse(disable.body)
    assert.equal(j.data.status, 'disabled')
    assert.equal(j.data.enabled, false)

    // Verify it actually moved
    const res = await runRoute('/skills-nexus/workspace/skills?workspace=' + encodeURIComponent(root), undefined, deps)
    assert.equal(res.status, 200)
    const entries = JSON.parse(res.body).data.entries
    const disabled = entries.find((e: any) => e.name === 'alpha')
    assert.ok(disabled)
    assert.equal(disabled.enabled, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace-unavailable when registry is missing on toggle', async () => {
  const res = await runRoute(
    '/skills-nexus/workspace/toggle',
    { workspace: '/abs', name: 'x', enabled: true },
    {},
    'POST',
  )
  assert.equal(res.status, 503)
  assert.equal(JSON.parse(res.body).error, 'workspace-unavailable')
})
