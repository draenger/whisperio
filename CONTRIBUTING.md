# Contributing to Whisperio

Thanks for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone https://github.com/draenger/whisperio.git
cd whisperio
npm install
npm run dev
```

## Running tests

```bash
npm test
```

All tests must pass before submitting a PR.

## Code style

- No semicolons
- Inline styles with a `styles` object pattern (no CSS files)
- IPC channels use `namespace:action` format (e.g. `settings:load`)
- `src/preload/index.ts` and `src/preload/index.d.ts` must stay in sync

## Submitting changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test` and `npm run typecheck`
4. Open a pull request against `main`

Keep PRs focused — one feature or fix per PR. Include a clear description of what changed and why.

## Reporting bugs

Use the [bug report template](https://github.com/draenger/whisperio/issues/new?template=bug_report.md).

## Feature requests

Use the [feature request template](https://github.com/draenger/whisperio/issues/new?template=feature_request.md).

## Project structure

```
desktop/          Electron app (Windows/macOS/Linux)
  src/
    main/           Electron main process
      dictation/      Hotkey state machine, overlay, auto-paste
      transcribe.ts   OpenAI & ElevenLabs STT
      modelManager.ts Local model downloads
      settingsManager.ts Settings persistence
    renderer/       React UI
    preload/        IPC bridge (index.ts + index.d.ts)
  tests/          Vitest unit tests
mobile/           iOS + Apple Watch app (Swift) + WhisperioKit
docs/             Project website (GitHub Pages)
```

Desktop commands run from `desktop/` (`cd desktop && npm install`).

## License

By contributing, you agree that your contributions are licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md) — the same license as the
project. You also grant Daniel Kasprzyk (the maintainer) a perpetual,
irrevocable, worldwide license to use, modify, and relicense your contributions,
**including under a commercial license**. This lets the project offer commercial
licenses on request while keeping the public source noncommercial. You confirm
you have the right to contribute the code (it's yours, or you're permitted to
submit it).

Please don't add dependencies under licenses incompatible with noncommercial
distribution without flagging it first.
