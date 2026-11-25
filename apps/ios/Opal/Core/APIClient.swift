import CryptoKit
import Foundation

struct APIError: LocalizedError, Sendable {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// Talks to the Opal API. Every request carries the site-lock token (`x-opal-gate`) and, once
/// signed in, the session as `Authorization: Bearer` (Better Auth bearer plugin).
final class APIClient: Sendable {
    let base: URL
    private let gateToken: @Sendable () -> String?
    private let sessionToken: @Sendable () -> String?

    init(base: URL = Config.baseURL, gateToken: @escaping @Sendable () -> String?, sessionToken: @escaping @Sendable () -> String?) {
        self.base = base
        self.gateToken = gateToken
        self.sessionToken = sessionToken
    }

    func request(_ path: String, method: String = "GET", json: (any Encodable)? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: base) else { throw APIError(status: 0, code: "bad_url", message: "Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 60
        if let gate = gateToken() { req.setValue(gate, forHTTPHeaderField: "x-opal-gate") }
        if let token = sessionToken() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(AnyEncodable(json))
        }
        return req
    }

    /// `cache`: keep the answer on disk (GETs only), so the screen can show it straight away
    /// next time, and offline, while it asks again (see `cached`).
    func send<T: Decodable>(_ path: String, method: String = "GET", json: (any Encodable)? = nil, as: T.Type, cache: Bool = false) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: try request(path, method: method, json: json))
        try Self.check(response, data)
        let value = try JSONDecoder.opal.decode(T.self, from: data)
        if cache && method == "GET" { ResponseCache.write(data, for: path) }
        return value
    }

    /// The last answer `send(..., cache: true)` kept for this path, if any.
    func cached<T: Decodable>(_ path: String, as: T.Type) -> T? {
        ResponseCache.read(path).flatMap { try? JSONDecoder.opal.decode(T.self, from: $0) }
    }

    /// Returns the raw response too (used to read the `set-auth-token` header).
    func sendRaw(_ path: String, method: String = "POST", json: (any Encodable)? = nil) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: try request(path, method: method, json: json))
        try Self.check(response, data)
        return (data, response as! HTTPURLResponse)
    }

    /// Uploads one file as multipart form data (field "file" unless told otherwise).
    func upload<T: Decodable>(_ path: String, field: String = "file", data: Data, filename: String, mediaType: String, extra: [String: String] = [:], as: T.Type) async throws -> T {
        var req = try request(path, method: "POST")
        req.timeoutInterval = 120
        let boundary = "opal-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let safeName = filename.replacingOccurrences(of: "\"", with: "")
        var body = Data()
        let crlf = "\r\n"
        for (key, value) in extra.sorted(by: { $0.key < $1.key }) {
            body.append(Data("--\(boundary)\(crlf)Content-Disposition: form-data; name=\"\(key)\"\(crlf)\(crlf)\(value)\(crlf)".utf8))
        }
        let head = "--\(boundary)\(crlf)Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(safeName)\"\(crlf)Content-Type: \(mediaType)\(crlf)\(crlf)"
        body.append(Data(head.utf8))
        body.append(data)
        body.append(Data("\(crlf)--\(boundary)--\(crlf)".utf8))
        let (resData, response) = try await URLSession.shared.upload(for: req, from: body)
        try Self.check(response, resData)
        return try JSONDecoder.opal.decode(T.self, from: resData)
    }

    /// Raw bytes of something on the server (attachments, images).
    func data(_ path: String) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: try request(path))
        try Self.check(response, data)
        return data
    }

    static func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError(
                status: http.statusCode,
                code: body?["error"] as? String ?? "error",
                message: body?["message"] as? String ?? "Request failed (\(http.statusCode))"
            )
        }
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: any Encoder) throws { try value.encode(to: encoder) }
}

extension JSONDecoder {
    static let opal: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return f.date(from: s) ?? ISO8601DateFormatter().date(from: s) ?? .now
        }
        return d
    }()
}

/// Answers kept on disk (in Caches, so the system may clear them), one file per path. Cleared on
/// sign-out.
enum ResponseCache {
    private static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("opal-api", isDirectory: true)
    }

    private static func file(_ path: String) -> URL {
        let digest = SHA256.hash(data: Data((Config.baseURL.absoluteString + path).utf8))
        return directory.appendingPathComponent(digest.map { String(format: "%02x", $0) }.joined() + ".json")
    }

    static func read(_ path: String) -> Data? {
        try? Data(contentsOf: file(path))
    }

    static func write(_ data: Data, for path: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: file(path), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear() {
        try? FileManager.default.removeItem(at: directory)
    }
}
