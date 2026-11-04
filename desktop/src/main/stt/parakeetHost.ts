// EXPERIMENTAL Parakeet host: entry of an Electron utilityProcess (separate OS process), built as its
// own main-process bundle (out/main/parakeetHost.js, see electron.vite.config.ts). It is the ONLY place
// that loads the native sherpa-onnx addon, so a native crash ends this process, not the app.
//
// Protocol (messages via process.parentPort):
//   in : {type:'init', sherpaPath, config}  -> out {type:'ready'} | {type:'fatal', error}
//   in : {id, samples, sampleRate}          -> out {type:'result', id, text} | {type:'result', id, error}

/** Pure recognition step. `sherpa` is the sherpa-onnx-node module. */
export function recognizeWith(
  sherpa: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  recognizer: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  samples: Float32Array,
  sampleRate: number
): string {
  void sherpa
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate, samples })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return String(result?.text ?? '').trim()
}

interface ParentPort {
  on(event: 'message', cb: (e: { data: unknown }) => void): void
  postMessage(m: unknown): void
}

/** Wire the protocol onto a parent port. `load` loads the addon (injectable for tests). */
export function runHost(
  port: ParentPort,
  load: (path: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
): void {
  let sherpa: any // eslint-disable-line @typescript-eslint/no-explicit-any
  let recognizer: any // eslint-disable-line @typescript-eslint/no-explicit-any
  port.on('message', (e) => {
    const m = e.data as {
      type?: string
      sherpaPath?: string
      config?: unknown
      id?: number
      samples?: Float32Array
      sampleRate?: number
    }
    if (m.type === 'init') {
      try {
        sherpa = load(m.sherpaPath as string)
        recognizer = new sherpa.OfflineRecognizer(m.config)
        port.postMessage({ type: 'ready' })
      } catch (err) {
        port.postMessage({ type: 'fatal', error: String((err as Error)?.message || err) })
      }
      return
    }
    if (m.id === undefined) return
    try {
      if (!recognizer) throw new Error('Parakeet recognizer is not initialised.')
      const text = recognizeWith(sherpa, recognizer, m.samples as Float32Array, m.sampleRate as number)
      port.postMessage({ type: 'result', id: m.id, text })
    } catch (err) {
      port.postMessage({ type: 'result', id: m.id, error: String((err as Error)?.message || err) })
    }
  })
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (parentPort) runHost(parentPort, (p) => require(p))
