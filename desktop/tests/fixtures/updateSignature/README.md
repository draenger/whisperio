Authenticode test fixtures for `../authenticode.ts`. Base binary: WiX `candle.exe` (28 KB, unsigned,
from `electron-winstaller/vendor`, MS-RL). Signed with electron-builder's cached signtool. These files are
never executed, only parsed.

- `pinned-sha256.exe`: a THROWAWAY test cert `CN=Jarvis Test Pin (fixtures only)`, thumbprint
  `F52FCA9BE37A14C24FF516628067F177AF6A7B96`, `/fd sha256`. The tests pin this cert.
- `pinned-sha1.exe`: same test cert, `/fd sha1` (rejected: weak digest).
- `foreign-sha256.exe`: another throwaway cert with the release CN `Jarvis (Daniel Kasprzyk)` (rejected
  against the release pin: a CN match is not enough).
- `unsigned.exe`: the base binary.

None of them is signed with the release cert, so none is a valid Jarvis update. The release cert is checked
on real builds by `../releaseGate.test.ts` (run by `scripts/release-desktop.mjs`).
