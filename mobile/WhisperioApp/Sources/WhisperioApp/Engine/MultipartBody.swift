import Foundation
import WhisperioKit

// Shared multipart/form-data builder for the cloud transcription providers, so the
// boundary/field/file framing lives in one place instead of being copy-pasted per provider.
struct MultipartBody {
    let boundary = "----whisperio-\(UUID().uuidString)"
    private var data = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    /// Append a plain text form field.
    mutating func field(_ name: String, _ value: String) {
        data.appendString("--\(boundary)\r\n")
        data.appendString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        data.appendString("\(value)\r\n")
    }

    /// Append a file part. The filename is sanitized (quotes/CR/LF stripped) so a hostile
    /// or odd clip name can't break out of the Content-Disposition header.
    mutating func file(name: String, filename: String, contentType: String, data fileData: Data) {
        let safe = filename.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
        data.appendString("--\(boundary)\r\n")
        data.appendString("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(safe)\"\r\n")
        data.appendString("Content-Type: \(contentType)\r\n\r\n")
        data.append(fileData)
        data.appendString("\r\n")
    }

    /// Close the body with the terminating boundary and return the finished payload.
    func finalize() -> Data {
        var out = data
        out.appendString("--\(boundary)--\r\n")
        return out
    }

    /// Session for provider uploads: audio clips can be large and cell links slow, so give
    /// requests real timeouts instead of URLSession.shared's defaults stalling a transcribe.
    static let uploadSession: URLSession = {
        // Never follows redirects: a 3xx must not re-send the audio + Bearer key to another host.
        NoRedirectSessionDelegate.makeSession(requestTimeout: 120,    // idle timeout between bytes
                                              resourceTimeout: 600)   // hard cap for the whole upload+response
    }()
}

extension Data {
    mutating func appendString(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
