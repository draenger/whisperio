// LAB / experimental desktop build: the release config (electron-builder.yml) plus the
// EXPERIMENTAL Parakeet native addon (sherpa-onnx). Never published: separate artifact names,
// no publish target, so it cannot overwrite a release asset or latest*.yml.
//   cd desktop && npm run build:lab:win   (or :linux / :mac)
const { readFileSync } = require('fs')
const { join } = require('path')
const yaml = require(require.resolve('js-yaml', { paths: [join(__dirname, '..', 'desktop')] }))

const base = yaml.load(readFileSync(join(__dirname, 'electron-builder.yml'), 'utf8'))
const SHERPA = ['node_modules/sherpa-onnx-node/**', 'node_modules/sherpa-onnx-*/**']

module.exports = {
  ...base,
  files: (base.files ?? []).filter((p) => !SHERPA.some((s) => p === `!${s}`)),
  asarUnpack: [...(base.asarUnpack ?? []), ...SHERPA],
  artifactName: '${productName}-lab-${version}-${arch}.${ext}',
  directories: { ...(base.directories ?? {}), output: 'dist-lab' },
  publish: null
}
