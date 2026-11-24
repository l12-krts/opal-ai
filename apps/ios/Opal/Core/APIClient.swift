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

    func send<T: Decodable>(_ path: String, method: String = "GET", json: (any Encodable)? = nil, as: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: try request(path, method: method, json: json))
        try Self.check(response, data)
        return try JSONDecoder.opal.decode(T.self, from: data)
    }

    /// Returns the raw response too (used to read the `set-auth-token` header).
    func sendRaw(_ path: String, method: String = "POST", json: (any Encodable)? = nil) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: try request(path, method: method, json: json))
        try Self.check(response, data)
        return (data, response as! HTTPURLResponse)
    }

    /// Uploads one file as multipart form data (field "file").
    func upload<T: Decodable>(_ path: String, data: Data, filename: String, mediaType: String, as: T.Type) async throws -> T {
        var req = try request(path, method: "POST")
        req.timeoutInterval = 120
        let boundary = "opal-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let safeName = filename.replacingOccurrences(of: "\"", with: "")
        var body = Data()
        let crlf = "\r\n"
        let head = "--\(boundary)\(crlf)Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\(crlf)Content-Type: \(mediaType)\(crlf)\(crlf)"
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
