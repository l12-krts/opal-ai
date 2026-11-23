import Foundation
import Observation
import SwiftUI
import UIKit

/// A file picked in the composer. It uploads right away; the message waits until it's done.
struct PendingAttachment: Identifiable {
    enum State { case uploading, ready(url: String), failed }
    let id: String
    let filename: String
    let mediaType: String
    let preview: UIImage?
    var state: State
}

/// One conversation: loads history, sends messages and applies the server's streamed
/// UI-message chunks (Server-Sent Events) to the assistant message as they arrive.
@MainActor
@Observable
final class ChatModel {
    enum Status { case idle, sending, streaming, failed(String) }

    let id: String
    private(set) var messages: [ChatMessage] = []
    private(set) var status: Status = .idle
    var title: String = ""
    var studyMode = false
    /// Composer toggles: hand the turn to agents, answer in handwriting.
    var useAgents = false
    var handwriting = false
    /// The model picked for this chat; nil uses the account default.
    var modelId: String?
    private(set) var attachments: [PendingAttachment] = []
    var agentId: String?
    private var started: Bool
    private var task: Task<Void, Never>?
    private let session: SessionStore

    init(id: String = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(21).description, isNew: Bool, session: SessionStore, agentId: String? = nil) {
        self.id = id
        self.started = !isNew
        self.session = session
        self.agentId = agentId
    }

    var uploading: Bool { attachments.contains { if case .uploading = $0.state { return true } else { return false } } }

    func attach(data: Data, filename: String, mediaType: String, preview: UIImage?) {
        let id = UUID().uuidString
        withAnimation(Motion.morph) {
            attachments.append(PendingAttachment(id: id, filename: filename, mediaType: mediaType, preview: preview, state: .uploading))
        }
        Task {
            struct Res: Decodable { struct A: Decodable { let url: String }; let attachment: A }
            let state: PendingAttachment.State
            do {
                let res = try await session.api.upload("/api/attachments", data: data, filename: filename, mediaType: mediaType, as: Res.self)
                state = .ready(url: res.attachment.url)
            } catch {
                state = .failed
            }
            if let i = attachments.firstIndex(where: { $0.id == id }) { attachments[i].state = state }
        }
    }

    func removeAttachment(_ id: String) {
        withAnimation(Motion.morph) { attachments.removeAll { $0.id == id } }
    }

    var busy: Bool { if case .sending = status { return true }; if case .streaming = status { return true }; return false }

    func load() async {
        guard started else { return }
        struct Res: Decodable {
            struct Conv: Decodable { let title: String; let mode: String }
            struct Msg: Decodable { let id: String; let role: String; let parts: [JSONValue] }
            let conversation: Conv
            let messages: [Msg]
        }
        do {
            let res = try await session.api.send("/api/conversations/\(id)", as: Res.self)
            title = res.conversation.title
            studyMode = res.conversation.mode == "study"
            messages = res.messages.map { m in
                ChatMessage(id: m.id, role: m.role, parts: m.parts.enumerated().compactMap { Part.from($1, index: $0) })
            }
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files: [(url: String, a: PendingAttachment)] = attachments.compactMap { a in
            if case .ready(let url) = a.state { return (url, a) } else { return nil }
        }
        guard !trimmed.isEmpty || !files.isEmpty, !busy, !uploading else { return }
        let msgId = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(20))
        var shown: [Part] = files.enumerated().map { i, f in .file(id: "f\(i)", url: f.url, mediaType: f.a.mediaType, filename: f.a.filename) }
        var sent: [JSONValue] = files.map { f in
            .object(["type": .string("file"), "url": .string(f.url), "mediaType": .string(f.a.mediaType), "filename": .string(f.a.filename)])
        }
        if !trimmed.isEmpty {
            shown.append(.text(id: "t0", text: trimmed))
            sent.insert(.object(["type": .string("text"), "text": .string(trimmed)]), at: 0)
        }
        withAnimation(.snappy(duration: 0.3)) {
            messages.append(ChatMessage(id: msgId, role: "user", parts: shown))
            attachments = []
        }
        var body: [String: JSONValue] = [
            "conversationId": .string(id),
            "mode": .string(studyMode ? "study" : "chat"),
            "message": .object([
                "id": .string(msgId),
                "role": .string("user"),
                "parts": .array(sent),
            ]),
        ]
        if let agentId { body["agentId"] = .string(agentId) }
        if let modelId { body["model"] = .string(modelId) }
        if useAgents || handwriting {
            body["tools"] = .object(["agents": .bool(useAgents), "handwriting": .bool(handwriting)])
        }
        started = true
        stream(body)
    }

    func respondToApproval(_ approvalId: String, approved: Bool) {
        stream(["conversationId": .string(id), "approvals": .array([.object(["approvalId": .string(approvalId), "approved": .bool(approved)])])], continuing: true)
    }

    func answer(tool: String, toolCallId: String, output: [String: JSONValue]) {
        stream(["conversationId": .string(id), "toolOutputs": .array([.object(["toolCallId": .string(toolCallId), "tool": .string(tool), "output": .object(output)])])], continuing: true)
    }

    func stop() {
        task?.cancel()
        status = .idle
    }

    // MARK: Streaming

    private func stream(_ body: [String: JSONValue], continuing: Bool = false) {
        status = .sending
        task = Task {
            do {
                var req = try session.api.request("/api/chat", method: "POST", json: JSONValue.object(body))
                req.timeoutInterval = 900
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                let (bytes, response) = try await URLSession.shared.bytes(for: req)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    var data = Data()
                    for try await b in bytes { data.append(b) }
                    try APIClient.check(response, data)
                }
                status = .streaming
                if !continuing || messages.last?.role != "assistant" {
                    messages.append(ChatMessage(id: "pending", role: "assistant", parts: []))
                }
                for try await line in bytes.lines {
                    guard line.hasPrefix("data: ") else { continue }
                    let payload = line.dropFirst(6)
                    if payload == "[DONE]" { break }
                    guard let data = payload.data(using: .utf8), let chunk = try? JSONDecoder().decode(JSONValue.self, from: data) else { continue }
                    apply(chunk)
                }
                status = .idle
            } catch is CancellationError {
                status = .idle
            } catch let e as APIError where e.status == 401 {
                session.handleUnauthorized(e)
            } catch {
                status = .failed(error.localizedDescription)
            }
        }
    }

    private func mutateLast(_ f: (inout ChatMessage) -> Void) {
        guard let i = messages.indices.last, messages[i].role == "assistant" else { return }
        f(&messages[i])
    }

    private func apply(_ c: JSONValue) {
        guard let type = c["type"]?.string else { return }
        switch type {
        case "start":
            if let id = c["messageId"]?.string { mutateLast { $0.id = id } }
        case "text-start":
            let id = c["id"]?.string ?? UUID().uuidString
            mutateLast { $0.parts.append(.text(id: id, text: "")) }
        case "text-delta":
            let id = c["id"]?.string
            let delta = c["delta"]?.string ?? ""
            mutateLast { m in
                if let i = m.parts.lastIndex(where: { if case .text(let pid, _) = $0 { return pid == id || id == nil } else { return false } }),
                   case .text(let pid, let t) = m.parts[i] {
                    m.parts[i] = .text(id: pid, text: t + delta)
                } else {
                    m.parts.append(.text(id: id ?? UUID().uuidString, text: delta))
                }
            }
        case "reasoning-start":
            let id = c["id"]?.string ?? UUID().uuidString
            mutateLast { $0.parts.append(.reasoning(id: id, text: "")) }
        case "reasoning-delta":
            let delta = c["delta"]?.string ?? ""
            mutateLast { m in
                if let i = m.parts.lastIndex(where: { if case .reasoning = $0 { return true } else { return false } }), case .reasoning(let id, let t) = m.parts[i] {
                    m.parts[i] = .reasoning(id: id, text: t + delta)
                }
            }
        case "tool-input-start", "tool-input-available", "tool-output-available", "tool-output-error", "tool-approval-request", "tool-output-denied":
            updateTool(type: type, chunk: c)
        case "data-agent":
            guard let data = c["data"] else { return }
            let run = AgentRun(data)
            mutateLast { m in
                if let i = m.parts.firstIndex(where: { if case .agent(let r) = $0 { return r.runId == run.runId } else { return false } }) {
                    m.parts[i] = .agent(run)
                } else {
                    m.parts.append(.agent(run))
                }
            }
        case "data-agent-msg":
            let d = c["data"]
            mutateLast { $0.parts.append(.agentMessage(id: UUID().uuidString, from: d?["from"]?["name"]?.string ?? "", to: d?["to"]?["name"]?.string ?? "", text: d?["text"]?.string ?? "")) }
        case "data-route":
            mutateLast { $0.parts.insert(.route(route: c["data"]?["route"]?.string ?? "direct", reason: c["data"]?["reason"]?.string ?? ""), at: 0) }
        case "data-title":
            if let t = c["data"]?["title"]?.string { title = t }
        case "error":
            status = .failed(c["errorText"]?.string ?? "Something went wrong")
        default:
            break
        }
    }

    private func updateTool(type: String, chunk c: JSONValue) {
        guard let callId = c["toolCallId"]?.string else { return }
        mutateLast { m in
            let idx = m.parts.firstIndex { if case .tool(let id, _, _, _, _, _, _) = $0 { return id == callId } else { return false } }
            var name = c["toolName"]?.string ?? ""
            var state = "input-streaming"
            var input: JSONValue?
            var output: JSONValue?
            var error: String?
            var approval: String?
            if let idx, case .tool(_, let n, let s, let i, let o, let e, let a) = m.parts[idx] {
                name = name.isEmpty ? n : name
                state = s; input = i; output = o; error = e; approval = a
            }
            switch type {
            case "tool-input-available": state = "input-available"; input = c["input"]
            case "tool-output-available": state = "output-available"; output = c["output"]
            case "tool-output-error": state = "output-error"; error = c["errorText"]?.string
            case "tool-approval-request": state = "approval-requested"; approval = c["approvalId"]?.string
            case "tool-output-denied": state = "output-denied"
            default: break
            }
            let part = Part.tool(id: callId, name: name, state: state, input: input, output: output, error: error, approvalId: approval)
            if let idx { m.parts[idx] = part } else { m.parts.append(part) }
        }
    }
}
