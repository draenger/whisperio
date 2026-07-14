// Static reachability analyzer for the renderer's React component tree.
//
// Gate 3 (see docs/PARITY.md / AUTOBUILD-SPEC.md): "Any orphan is a FAILURE."
// A component is "defined" if it's an exported, JSX-returning function in
// src/renderer/components/** or a direct src/renderer/*.tsx file (outside the
// window entrypoints). It's "reachable" if there's a real JSX call-site
// (`<Name ... />` or `<Name>`) chaining it back to one of the three renderer
// entrypoints (settings.tsx / recordings.tsx / overlay.tsx).
//
// Deliberately dependency-free: no ts-morph/babel, just regexes tuned to this
// repo's actual authoring conventions (verified against every component file
// at the time this was written — see reachability.spec.ts's sanity check,
// which guards against the regexes silently matching nothing after a
// refactor and the orphan check passing vacuously).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DESKTOP_ROOT = resolve(HERE, '../..')
export const RENDERER_ROOT = resolve(DESKTOP_ROOT, 'src/renderer')

// The three windows Electron actually mounts (see electron.vite.config.ts /
// src/main/*Window.ts). Everything reachable in the app has to trace back to
// one of these.
export const ENTRYPOINTS = ['settings/settings.tsx', 'recordings/recordings.tsx', 'dictation/overlay.tsx'].map((p) =>
  join(RENDERER_ROOT, p)
)

export interface ComponentExport {
  file: string
  name: string
}

function keyFor(file: string, name: string): string {
  return `${relative(DESKTOP_ROOT, file)}#${name}`
}

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkTsx(full, out)
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Component *surface* files: everything under src/renderer/components/**,
 * plus direct .tsx children of src/renderer/ itself (e.g. ThemeContext.tsx),
 * excluding the entrypoints (which bootstrap the tree via createRoot/render
 * but don't export components of their own).
 */
export function candidateComponentFiles(): string[] {
  const componentsDir = join(RENDERER_ROOT, 'components')
  const nested = walkTsx(componentsDir)
  const topLevel = readdirSync(RENDERER_ROOT)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(RENDERER_ROOT, f))
  const entrySet = new Set(ENTRYPOINTS)
  return [...nested, ...topLevel].filter((f) => !entrySet.has(f))
}

/**
 * Finds `export function Name(...): ReactElement { ... }` /
 * `export function Name(...): JSX.Element { ... }` declarations (this repo's
 * component convention, including generics like `Segmented<T extends
 * string>({...})`), plus the arrow-function equivalent for forward-compat.
 * Not a real parser: scans the window between one `export function`/`export
 * const` and the next, and checks it contains a `): ReactElement`/`): JSX.Element`
 * return-type annotation before the body opens. That's enough to
 * disambiguate components (e.g. `CleanupPanel`) from plain exported functions
 * in the same files (e.g. `isOnDeviceBaseUrl(): boolean`).
 */
export function findComponentExports(file: string, source: string): ComponentExport[] {
  const results: ComponentExport[] = []
  const seen = new Set<string>()

  const funcStarts: { name: string; index: number }[] = []
  const funcRe = /export function ([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = funcRe.exec(source))) {
    funcStarts.push({ name: m[1], index: m.index })
  }
  for (let i = 0; i < funcStarts.length; i++) {
    const { name, index } = funcStarts[i]
    const windowEnd = i + 1 < funcStarts.length ? funcStarts[i + 1].index : source.length
    const win = source.slice(index, windowEnd)
    if (/\)\s*:\s*(ReactElement|JSX\.Element)\s*\{/.test(win)) {
      results.push({ file, name })
      seen.add(name)
    }
  }

  const arrowRe = /export const ([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\(/g
  while ((m = arrowRe.exec(source))) {
    const name = m[1]
    if (seen.has(name)) continue
    const nextExport = source.indexOf('\nexport ', m.index + 1)
    const win = source.slice(m.index, nextExport === -1 ? source.length : nextExport)
    if (/\)\s*:\s*(ReactElement|JSX\.Element)\s*=>/.test(win)) {
      results.push({ file, name })
      seen.add(name)
    }
  }

  return results
}

/**
 * `<Name` JSX call-sites (opening tags) anywhere in the file.
 *
 * The negative lookbehind is load-bearing, not cosmetic: TypeScript generic
 * instantiation (`useState<AiProvider>(...)`) is textually indistinguishable
 * from a JSX tag (`<AiProvider>`) once you're past the `<`. A real JSX tag is
 * never immediately preceded by an identifier character (it follows
 * whitespace, `(`, `{`, `>`, `,`, or start-of-file); `useState<...` has `e`
 * right before the `<`. Without this guard, `useState<AiProvider>` would
 * register as a "call-site" for a component literally named AiProvider —
 * i.e. exactly the false-positive that could mask a real orphan sharing a
 * name with a type.
 */
export function findJsxUsages(source: string): Set<string> {
  const set = new Set<string>()
  const re = /(?<![\w$])<([A-Z][\w$]*)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) set.add(m[1])
  return set
}

interface RelativeImport {
  localName: string
  importedName: string
  fromFile: string
}

function resolveImportPath(fromFile: string, rawPath: string): string | null {
  const base = resolve(dirname(fromFile), rawPath)
  const candidates = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]
  return candidates.find((c) => existsSync(c)) ?? null
}

/** Named imports from relative paths (`./Foo`, `../bar/Baz`) — the only
 * imports that can resolve to another renderer source file. Handles
 * `{ A, type B, C as D }` as well as a fully type-only `import type { A, B }`
 * (the leading `type` keyword makes every name in the brace type-only, not
 * just the first); ignores type-only names and non-relative (package)
 * imports. Type-only names are excluded on purpose — a type import can never
 * produce a JSX call-site, so counting it as a component reference would be
 * another way to mask a real orphan. */
export function findRelativeImports(file: string, source: string): RelativeImport[] {
  const results: RelativeImport[] = []
  const importRe = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = importRe.exec(source))) {
    const wholeImportIsTypeOnly = Boolean(m[1])
    if (wholeImportIsTypeOnly) continue
    const resolved = resolveImportPath(file, m[3])
    if (!resolved) continue
    for (const raw of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith('type ')) continue
      const aliased = raw.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (aliased) {
        results.push({ localName: aliased[2], importedName: aliased[1], fromFile: resolved })
      } else {
        results.push({ localName: raw, importedName: raw, fromFile: resolved })
      }
    }
  }
  return results
}

export interface ReachabilityResult {
  defined: ComponentExport[]
  definedKeys: string[]
  reachableKeys: Set<string>
}

/**
 * BFS from the three entrypoints, following only real JSX call-sites (not
 * the plain import graph — an unused import doesn't make a component
 * reachable). Two ways a component gets marked reachable:
 *  1. A file renders one of its own locally-defined components
 *     (e.g. SettingsForm.tsx using its own <Segmented>/<ToggleRow>).
 *  2. A file imports a component from another file AND renders it as JSX
 *     (not just imports the type) — which also enqueues that file so the
 *     traversal continues into it.
 */
export function computeReachability(): ReachabilityResult {
  const sourceCache = new Map<string, string>()
  const readSrc = (f: string): string => {
    let s = sourceCache.get(f)
    if (s === undefined) {
      s = readFileSync(f, 'utf8')
      sourceCache.set(f, s)
    }
    return s
  }

  const files = candidateComponentFiles()
  const defined: ComponentExport[] = []
  for (const f of files) {
    defined.push(...findComponentExports(f, readSrc(f)))
  }

  const reachableKeys = new Set<string>()
  const visitedFiles = new Set<string>()
  const queue: string[] = [...ENTRYPOINTS]

  while (queue.length > 0) {
    const file = queue.shift()!
    if (visitedFiles.has(file)) continue
    visitedFiles.add(file)

    let src: string
    try {
      src = readSrc(file)
    } catch {
      continue
    }

    const jsxUsed = findJsxUsages(src)

    for (const c of findComponentExports(file, src)) {
      if (jsxUsed.has(c.name)) reachableKeys.add(keyFor(file, c.name))
    }

    for (const imp of findRelativeImports(file, src)) {
      if (jsxUsed.has(imp.localName)) {
        reachableKeys.add(keyFor(imp.fromFile, imp.importedName))
        if (!visitedFiles.has(imp.fromFile)) queue.push(imp.fromFile)
      }
    }
  }

  return { defined, definedKeys: defined.map((c) => keyFor(c.file, c.name)), reachableKeys }
}

export { keyFor }
