#!/usr/bin/env node
// 发版一致性守卫：tag / package.json / package-lock.json / CHANGELOG 必须指向同一版本，
// 且 tag 必须落在 master 上。npm publish 前由 prepublishOnly 自动执行。
import { execFileSync } from 'node:child_process'

const USAGE = `用法：
  node scripts/release-check.mjs            检查 HEAD 上的版本 tag（发布前使用）
  node scripts/release-check.mjs v0.10.0    检查指定 tag 的快照`

const argv = process.argv.slice(2)
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE)
  process.exit(0)
}
if (argv.length > 1) {
  console.error(USAGE)
  process.exit(2)
}
const explicitTag = argv[0]

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

let root
try {
  root = git(['rev-parse', '--show-toplevel'], process.cwd())
} catch {
  console.error('release-check: FAIL\n  - 当前目录不在 git 仓库内')
  process.exit(1)
}

const failures = []
const warnings = []
const summary = []
const fail = (message) => failures.push(message)
const warn = (message) => warnings.push(message)

function tryGit(args) {
  try {
    return git(args, root)
  } catch {
    return null
  }
}

function show(tag, path) {
  return tryGit(['show', `${tag}:${path}`])
}

function isAncestor(commit, ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

let tag = explicitTag
if (!tag) {
  const tags = (tryGit(['tag', '--points-at', 'HEAD']) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => /^v\d/.test(name))
  if (tags.length === 0) {
    fail(
      'HEAD 上没有版本 tag。请先打 tag，或显式传入：node scripts/release-check.mjs v0.10.1',
    )
  } else if (tags.length > 1) {
    fail(`HEAD 上有多个版本 tag（${tags.join(', ')}），无法判断发布哪一个`)
  } else {
    tag = tags[0]
  }
}

let tagCommit = null
let version = null

if (tag) {
  tagCommit = tryGit(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])
  if (!tagCommit) {
    fail(`tag ${tag} 不存在`)
  } else {
    summary.push(['tag', tag])

    if (tryGit(['cat-file', '-t', `refs/tags/${tag}`]) === 'commit') {
      warn(`tag ${tag} 是轻量 tag；建议用 git tag -a 创建附注 tag`)
    }

    const rawPackage = show(tag, 'package.json')
    if (!rawPackage) {
      fail(`${tag} 快照里没有 package.json`)
    } else {
      let pkg = null
      try {
        pkg = JSON.parse(rawPackage)
      } catch {
        fail(`${tag} 快照里的 package.json 无法解析`)
      }
      version = pkg?.version ?? null
      if (!version) {
        fail(`${tag} 快照里的 package.json 缺少 version`)
      } else {
        summary.push(['package.json', version])
        if (tag !== `v${version}`) {
          fail(
            `tag ${tag} 与 package.json 版本 ${version} 不一致（tag 应为 v${version}）。` +
              '常见原因：改了版本没打对应 tag，或 tag 打了旧版本。',
          )
        }
      }
    }

    const rawLock = show(tag, 'package-lock.json')
    if (!rawLock) {
      fail(`${tag} 快照里没有 package-lock.json`)
    } else if (version) {
      try {
        const lock = JSON.parse(rawLock)
        const entries = [
          ['package-lock.json version', lock.version],
          ['package-lock.json packages[""].version', lock.packages?.['']?.version],
        ]
        let lockMatches = true
        for (const [label, value] of entries) {
          if (value !== version) {
            lockMatches = false
            fail(`${label} 是 ${value ?? '缺失'}，与 package.json 的 ${version} 不一致`)
          }
        }
        if (lockMatches) summary.push(['package-lock', version])
      } catch {
        fail(`${tag} 快照里的 package-lock.json 无法解析`)
      }
    }

    const changelog = show(tag, 'CHANGELOG.md')
    if (!changelog) {
      fail(`${tag} 快照里没有 CHANGELOG.md`)
    } else if (version) {
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const heading = new RegExp(
        `^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`,
        'm',
      ).exec(changelog)
      if (!heading) {
        fail(`CHANGELOG.md 缺少 "## [${version}] - YYYY-MM-DD" 小节`)
      } else {
        const rest = changelog.slice(heading.index + heading[0].length)
        const next = /^## \[/m.exec(rest)
        const body = (next ? rest.slice(0, next.index) : rest).trim()
        if (body.length === 0) {
          fail(`CHANGELOG.md 的 [${version}] 小节是空的`)
        } else {
          summary.push(['CHANGELOG', `[${version}] - ${heading[1]}`])
        }
      }
    }

    const masterRef = ['refs/heads/master', 'refs/remotes/origin/master'].find((ref) =>
      tryGit(['rev-parse', '--verify', '--quiet', ref]),
    )
    if (!masterRef) {
      warn('找不到本地 master 或 origin/master，跳过 master 归属检查')
    } else if (!isAncestor(tagCommit, masterRef)) {
      fail(`tag ${tag} 不在 master 上（${masterRef}）`)
    } else {
      summary.push(['master', `包含 ${tag}`])
    }
  }
}

if (!explicitTag) {
  const dirty = tryGit(['status', '--porcelain', '--untracked-files=no'])
  if (dirty === null) {
    fail('无法读取 git status')
  } else if (dirty.length > 0) {
    fail(
      '工作区有未提交的跟踪文件改动，发布只能来自 tag 快照：\n' +
        dirty
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n'),
    )
  } else {
    summary.push(['工作区', '干净（仅跟踪文件）'])
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`)

if (failures.length > 0) {
  console.error('release-check: FAIL')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('release-check: PASS')
for (const [label, value] of summary) console.log(`  ${label}: ${value}`)
