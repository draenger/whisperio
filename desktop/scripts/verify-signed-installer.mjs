#!/usr/bin/env node
// Verify a Windows installer with the app's OWN update verifier (pure Node, same code the installed
// app runs on every downloaded update) against the pinned release signer.
//   node scripts/verify-signed-installer.mjs dist/Whisperio-Setup-X.Y.Z.exe
// Unlike `signtool verify /pa` this does not need the self-signed root to be trusted on the machine.
// Exit 0 = the app would accept this installer; 1 = it would reject it (or the file is unreadable).
import { build } from 'esbuild'
import { existsSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const file = process.argv[2]
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/verify-signed-installer.mjs <installer.exe>')
  process.exit(2)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src', 'main', 'updateSignature', 'updateVerifier.ts')
const authenticode = join(root, 'src', 'main', 'updateSignature', 'authenticode.ts')
const bundle = await build({
  stdin: {
    contents: `export * from ${JSON.stringify(entry.replaceAll(sep, '/'))}; export { verifyAuthenticode } from ${JSON.stringify(authenticode.replaceAll(sep, '/'))}`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent'
})
const code = bundle.outputFiles[0].text
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

const r = await mod.verifyAuthenticode(resolve(file), mod.PINNED_UPDATE_SIGNERS)
if (r.ok) {
  console.log(`PASS  ${file}`)
  console.log(`  signer thumbprint: ${r.thumbprint}`)
  console.log(`  signer SPKI sha256: ${r.spkiSha256}`)
  console.log(`  digest: ${r.digest}`)
  process.exit(0)
}
console.error(`FAIL  ${file}\n  ${r.reason}`)
process.exit(1)
