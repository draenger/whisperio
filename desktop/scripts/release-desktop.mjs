#!/usr/bin/env node
// Signed Windows desktop release: finish the CI DRAFT GitHub release with the locally signed installer.
//   node scripts/release-desktop.mjs                       # DRY RUN (default): preflight + plan, nothing built/uploaded
//   node scripts/release-desktop.mjs --execute             # build:win:signed, verify:signed, sha512 check, upload to the draft
//   node scripts/release-desktop.mjs --execute --publish   # ... and flip the draft to published
// Options: --skip-build (execute: reuse dist/), --help.
// Exit codes: 0 ok, 1 preflight/verify failure, 2 usage. Never exports keys, never prints secrets.
// Modelled on Suzie's scripts/release-desktop.mjs. Docs: docs/release-runbook.md 1.4.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const THUMBPRINT = '2A917C6457B67B928C52413DB00FA34CAAF15206'
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const BOOL_FLAGS = ['execute', 'publish', 'skip-build', 'help']

/** @returns {{ok:true, opts:object}|{ok:false, error:string}} */
export function parseArgs(argv) {
  const opts = { execute: false, publish: false, 'skip-build': false, help: false }
  for (const a of argv) {
    const name = a.replace(/^--/, '')
    if (!a.startsWith('--') || !BOOL_FLAGS.includes(name)) {
      return { ok: false, error: `unknown argument ${a} (known: ${BOOL_FLAGS.map((f) => `--${f}`).join(' ')})` }
    }
    opts[name] = true
  }
  if (opts.publish && !opts.execute) return { ok: false, error: '--publish requires --execute' }
  if (opts['skip-build'] && !opts.execute) return { ok: false, error: '--skip-build only makes sense with --execute' }
  return { ok: true, opts }
}

/** sha512 of a file as base64 (what electron-builder writes into latest.yml). */
export function sha512Base64(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha512')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('base64')))
  })
}

/** Minimal latest.yml reader: top-level version/path/sha512 plus files[].url/sha512. */
export function parseLatestYml(text) {
  const top = (k) => (text.match(new RegExp(`^${k}:\\s*(\\S+)`, 'm')) ?? [])[1]
  const files = []
  for (const m of text.matchAll(/^\s*-\s*url:\s*(\S+)\s*\r?\n\s+sha512:\s*(\S+)/gm)) files.push({ url: m[1], sha512: m[2] })
  return { version: top('version'), path: top('path'), sha512: top('sha512'), files }
}

/** Compare latest.yml against expected version / installer name / actual sha512. Returns problem strings ([] = match). */
export function compareLatestYml(parsed, { version, installerName, sha512 }) {
  const problems = []
  if (parsed.version !== version) problems.push(`latest.yml version ${parsed.version ?? 'missing'} != ${version}`)
  if (parsed.path !== installerName) problems.push(`latest.yml path ${parsed.path ?? 'missing'} != ${installerName}`)
  if (parsed.sha512 !== sha512) problems.push('latest.yml sha512 does not match the signed installer (stale or different build)')
  const entry = parsed.files.find((f) => f.url === installerName)
  if (parsed.files.length && !entry) problems.push(`latest.yml files[] has no entry for ${installerName}`)
  else if (entry && entry.sha512 !== sha512) problems.push('latest.yml files[] sha512 does not match the signed installer')
  return problems
}

export function installerNameFor(version) {
  return `Whisperio-Setup-${version}.exe`
}

/** Plan rows: { n, step, command, run } */
export function buildPlan(version, opts) {
  const installer = `dist/${installerNameFor(version)}`
  const tag = `v${version}`
  const rows = [
    { step: 'preflight', command: 'git/gh/cert/signtool/draft checks (read-only)', mode: 'always' },
    { step: 'build', command: 'npm run build:win:signed', mode: 'execute', skipped: opts['skip-build'] },
    { step: 'verify', command: `npm run verify:signed -- ${installer}  +  latest.yml sha512 check`, mode: 'built' },
    { step: 'upload', command: `gh release upload ${tag} --clobber ${installer} dist/latest.yml`, mode: 'execute' },
    { step: 'publish', command: `gh release edit ${tag} --draft=false`, mode: 'publish' }
  ]
  return rows.map((r, i) => {
    let run
    if (r.mode === 'always') run = true
    else if (r.mode === 'built') run = opts.execute
    else if (r.mode === 'execute') run = opts.execute && !r.skipped
    else run = opts.execute && opts.publish
    return { n: i + 1, step: r.step, command: r.command, run }
  })
}

export function formatPlan(rows, opts) {
  const w = Math.max(...rows.map((r) => r.step.length))
  const lines = [`Plan (${opts.execute ? 'EXECUTE' : 'DRY RUN'}):`]
  for (const r of rows) lines.push(`  ${r.n}. ${r.step.padEnd(w)}  ${r.run ? 'RUN ' : 'skip'}  ${r.command}`)
  return lines.join('\n')
}

export function publishHint(version) {
  return `gh release edit v${version} --draft=false`
}

const defaultRun = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...o })

/** Newest signtool.exe from trusted locations (Windows SDK, then electron-builder cache). Same lookup as Suzie. */
export function findSigntool({ env = process.env, exists = existsSync, list = readdirSync } = {}) {
  const newest = (names) => names.sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))
  const candidates = []
  const kits = join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
  if (exists(kits)) for (const v of newest(list(kits))) candidates.push(join(kits, v, 'x64', 'signtool.exe'))
  const cache = join(env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'winCodeSign')
  if (exists(cache)) for (const d of newest(list(cache))) candidates.push(join(cache, d, 'windows-10', 'x64', 'signtool.exe'))
  return candidates.find((c) => exists(c))
}

/**
 * Preflight. Each check: { name, status: 'ok'|'warn'|'fail', detail }.
 * Hard checks (git, gh, cert, signtool) fail in both modes; draft/assets are 'warn' in dry-run, 'fail' when executing.
 * `deps` lets tests inject run / platform / version / findSigntool.
 */
export function preflight(opts, deps = {}) {
  const run = deps.run ?? defaultRun
  const platform = deps.platform ?? process.platform
  const version = deps.version
  const checks = []
  const add = (name, status, detail) => checks.push({ name, status, detail })
  const soft = opts.execute ? 'fail' : 'warn'
  const out = (r) => `${r.stdout ?? ''}`.trim()

  if (!SEMVER_RE.test(version ?? '')) add('version', 'fail', `desktop/package.json version "${version}" is not plain x.y.z`)
  else add('version', 'ok', version)
  const tag = `v${version}`

  const status = run('git', ['status', '--porcelain'])
  add(
    'git clean tree',
    status.status === 0 && !out(status) ? 'ok' : 'fail',
    status.status !== 0 ? 'git status failed' : out(status) ? 'working tree has uncommitted changes' : 'clean'
  )

  const branch = out(run('git', ['rev-parse', '--abbrev-ref', 'HEAD']))
  if (branch !== 'main' && branch !== 'release') add('git branch', 'fail', `on "${branch}", release from main or release`)
  else if (run('git', ['fetch', '-q', 'origin', branch]).status !== 0) add('git branch', 'fail', `git fetch origin ${branch} failed`)
  else {
    const head = out(run('git', ['rev-parse', 'HEAD']))
    const upstream = out(run('git', ['rev-parse', `origin/${branch}`]))
    add('git branch', head === upstream ? 'ok' : 'fail', head === upstream ? `${branch} == origin/${branch}` : `${branch} differs from origin/${branch} (pull/push first)`)
  }

  const localTag = run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
  const remoteTag = out(run('git', ['ls-remote', '--tags', 'origin', tag]))
  add('tag state', 'ok', `${tag}: local ${localTag.status === 0 ? 'exists' : 'absent'}, origin ${remoteTag ? 'exists' : 'absent'} (CI creates the tag with the draft)`)

  const auth = run('gh', ['auth', 'status'])
  add('gh auth', auth.status === 0 ? 'ok' : 'fail', auth.status === 0 ? 'authenticated' : 'gh auth status failed (gh auth login)')

  if (platform !== 'win32') {
    add('signing cert', 'fail', 'Windows signing must run on Windows (cert in Cert:\\CurrentUser\\My)')
    add('signtool', 'fail', 'Windows only')
  } else {
    const ps = run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `if (Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq '${THUMBPRINT}' }) { 'FOUND' } else { 'MISSING' }`
    ])
    const found = out(ps) === 'FOUND'
    add('signing cert', found ? 'ok' : 'fail', found ? `${THUMBPRINT} present (key not exported)` : `thumbprint ${THUMBPRINT} not in Cert:\\CurrentUser\\My`)
    const st = (deps.findSigntool ?? findSigntool)()
    add('signtool', st ? 'ok' : 'fail', st ?? 'signtool.exe not found in Windows SDK / electron-builder cache')
  }

  const rel = run('gh', ['release', 'view', tag, '--json', 'isDraft,assets'])
  if (rel.status !== 0) add('draft release', soft, `release ${tag} not found on GitHub (push to release branch so CI creates the draft)`)
  else {
    let j = null
    try { j = JSON.parse(rel.stdout) } catch { /* reported below */ }
    if (!j) add('draft release', soft, 'could not parse gh release view output')
    else {
      add('draft release', j.isDraft ? 'ok' : soft, j.isDraft ? `${tag} is a draft` : `${tag} is already published (--clobber would modify a live release)`)
      const names = (j.assets ?? []).map((a) => a.name)
      add('CI assets', names.length ? 'ok' : soft, names.length ? `${names.length} assets: ${names.join(', ')}` : 'draft has no CI assets (mac/linux build not finished?)')
    }
  }
  return checks
}

export function formatChecks(checks) {
  const tag = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' }
  return checks.map((c) => `  [${tag[c.status]}] ${c.name}: ${c.detail}`).join('\n')
}

function step(label, cmd, args, cwd, run) {
  console.log(`\n== ${label}: ${cmd} ${args.join(' ')}`)
  const r = run(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status === 0
}

export async function main(argv, deps = {}) {
  const parsed = parseArgs(argv)
  if (!parsed.ok) { console.error(`usage error: ${parsed.error}`); return 2 }
  const { opts } = parsed
  if (opts.help) {
    console.log('node scripts/release-desktop.mjs [--execute [--publish] [--skip-build]]   (dry run by default)')
    return 0
  }
  const root = deps.root ?? join(dirname(fileURLToPath(import.meta.url)), '..')
  const run = deps.run ?? defaultRun
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const tag = `v${version}`
  const installerName = installerNameFor(version)
  const installer = join(root, 'dist', installerName)
  const ymlPath = join(root, 'dist', 'latest.yml')

  console.log(`Whisperio desktop release ${tag} (${opts.execute ? 'EXECUTE' : 'DRY RUN'})\n`)
  console.log(formatPlan(buildPlan(version, opts), opts))

  console.log('\n1. preflight')
  const checks = preflight(opts, { run, version, platform: deps.platform, findSigntool: deps.findSigntool })
  console.log(formatChecks(checks))
  if (checks.some((c) => c.status === 'fail')) { console.error('\nFAIL preflight'); return 1 }

  if (!opts.execute) {
    const warns = checks.filter((c) => c.status === 'warn').length
    console.log(`\nDRY RUN complete${warns ? ` (${warns} warning(s) would block --execute)` : ''}. Nothing built or uploaded. Re-run with --execute.`)
    return 0
  }

  if (!opts['skip-build']) {
    console.log('\n2. build')
    if (!step('build', 'npm', ['run', 'build:win:signed'], root, run)) { console.error('FAIL build'); return 1 }
  }

  console.log('\n3. verify')
  if (!existsSync(installer) || !existsSync(ymlPath)) { console.error(`FAIL ${installer} or ${ymlPath} not found`); return 1 }
  if (!step('verify:signed', 'npm', ['run', 'verify:signed', '--', `dist/${installerName}`], root, run)) { console.error('FAIL signature verification'); return 1 }
  const sha512 = await sha512Base64(installer)
  const problems = compareLatestYml(parseLatestYml(readFileSync(ymlPath, 'utf8')), { version, installerName, sha512 })
  if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); return 1 }
  console.log(`PASS latest.yml ${version} matches ${installerName} (sha512)`)

  console.log('\n4. upload')
  if (!step('upload', 'gh', ['release', 'upload', tag, '--clobber', installer, ymlPath], root, run)) { console.error('FAIL upload'); return 1 }

  if (!opts.publish) {
    console.log(`\nUploaded to the DRAFT ${tag}. Not published. To publish:\n  ${publishHint(version)}`)
    return 0
  }
  console.log('\n5. publish')
  if (!step('publish', 'gh', ['release', 'edit', tag, '--draft=false'], root, run)) { console.error('FAIL publish'); return 1 }
  console.log(`\nDONE ${tag} published.`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`FAIL ${e.message}`); process.exit(1) })
}
