import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import yaml from 'js-yaml'

// Release vs lab packaging of the EXPERIMENTAL Parakeet addon (#47): the release installer must
// never carry the ~23 MB of unsigned sherpa-onnx / onnxruntime DLLs; only the lab build does.
const devops = join(__dirname, '..', '..', '.devops')
const release = yaml.load(readFileSync(join(devops, 'electron-builder.yml'), 'utf8')) as {
  files: string[]
  asarUnpack: string[]
  publish: unknown
}
const lab = createRequire(__filename)(join(devops, 'electron-builder.lab.cjs')) as {
  files: string[]
  asarUnpack: string[]
  publish: unknown
  artifactName: string
  directories: { output: string }
}
const SHERPA = ['node_modules/sherpa-onnx-node/**', 'node_modules/sherpa-onnx-*/**']

describe('Parakeet packaging', () => {
  it('release build excludes the sherpa-onnx addon and does not unpack it', () => {
    for (const p of SHERPA) expect(release.files).toContain(`!${p}`)
    expect(release.asarUnpack.some((p) => p.includes('sherpa'))).toBe(false)
  })
  it('lab build ships and unpacks it, and can never publish over a release', () => {
    expect(lab.files.some((p) => p.includes('sherpa'))).toBe(false)
    for (const p of SHERPA) expect(lab.asarUnpack).toContain(p)
    expect(lab.publish).toBeNull()
    expect(lab.artifactName).toContain('-lab-')
    expect(lab.directories.output).toBe('dist-lab')
  })
  it('lab keeps every other release setting (only the addon differs)', () => {
    expect(lab.files).toEqual(release.files.filter((p) => !p.includes('sherpa')))
    expect(lab.asarUnpack.filter((p) => !p.includes('sherpa'))).toEqual(release.asarUnpack)
  })
})
