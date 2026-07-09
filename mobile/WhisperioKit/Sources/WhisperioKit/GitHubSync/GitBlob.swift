import Foundation

/// Computes a file's Git blob object id — `sha1("blob " + <byteLength> + "\0" + <bytes>)`, the
/// exact hash Git stores. Used purely for idempotency: comparing a locally rendered file's blob
/// sha to the sha the repo already has lets the sync engine skip unchanged files without a diff.
public enum GitBlob {
    public static func sha1(_ bytes: Data) -> String {
        var input = Data("blob \(bytes.count)\u{0}".utf8)
        input.append(bytes)
        return SHA1.hexDigest(input)
    }

    public static func sha1(_ text: String) -> String {
        sha1(Data(text.utf8))
    }
}

/// Minimal, dependency-free SHA-1 (Foundation-only, no CryptoKit) — the kit stays pure Swift so
/// it builds/tests on any Apple platform. Only ever fed short Markdown files, so speed is a
/// non-issue; correctness is checked against known git-blob vectors in the tests.
enum SHA1 {
    static func hexDigest(_ message: Data) -> String {
        var h0: UInt32 = 0x67452301
        var h1: UInt32 = 0xEFCDAB89
        var h2: UInt32 = 0x98BADCFE
        var h3: UInt32 = 0x10325476
        var h4: UInt32 = 0xC3D2E1F0

        var msg = [UInt8](message)
        let bitLen = UInt64(msg.count) * 8

        // Append 0x80 then pad with zeros until length ≡ 56 (mod 64).
        msg.append(0x80)
        while msg.count % 64 != 56 { msg.append(0) }
        // Append the original length as a 64-bit big-endian integer.
        for shift in stride(from: 56, through: 0, by: -8) {
            msg.append(UInt8((bitLen >> UInt64(shift)) & 0xFF))
        }

        func rotl(_ v: UInt32, _ n: UInt32) -> UInt32 { (v << n) | (v >> (32 - n)) }

        var offset = 0
        while offset < msg.count {
            var w = [UInt32](repeating: 0, count: 80)
            for i in 0..<16 {
                let j = offset + i * 4
                w[i] = (UInt32(msg[j]) << 24) | (UInt32(msg[j + 1]) << 16)
                     | (UInt32(msg[j + 2]) << 8) | UInt32(msg[j + 3])
            }
            for i in 16..<80 {
                w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
            }

            var a = h0, b = h1, c = h2, d = h3, e = h4
            for i in 0..<80 {
                let f: UInt32
                let k: UInt32
                switch i {
                case 0..<20:  f = (b & c) | (~b & d);          k = 0x5A827999
                case 20..<40: f = b ^ c ^ d;                   k = 0x6ED9EBA1
                case 40..<60: f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC
                default:      f = b ^ c ^ d;                   k = 0xCA62C1D6
                }
                let temp = rotl(a, 5) &+ f &+ e &+ k &+ w[i]
                e = d; d = c; c = rotl(b, 30); b = a; a = temp
            }

            h0 = h0 &+ a; h1 = h1 &+ b; h2 = h2 &+ c; h3 = h3 &+ d; h4 = h4 &+ e
            offset += 64
        }

        return [h0, h1, h2, h3, h4].map { String(format: "%08x", $0) }.joined()
    }
}
