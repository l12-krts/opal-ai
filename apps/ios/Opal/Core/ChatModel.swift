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

/// What an agent's computer last showed (data-sandbox frames while a chat runs).
struct SandboxFrame: Identifiable, Equatable {
    struct Command: Equatable { let command: String; let output: String; let exitCode: Int }
    var id: String { agentId }
    let agentId: String
    var agentName: String
    var color: String
    var shape: String?
    var url: String?
    var title: String?
    var screenshot: String?
    var terminal: [Command] = []
}

/// One conversation: loads history, sends messages and applies the server's streamed
/// UI-message chunks (Server-Sent Events) to the assistant message as they arrive.
@MainActor
@Observable
final class ChatModel {
    enum Status: Equatable { case idle, sending, streaming, failed(String) }

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
    /// The agent whose thread this is (name, color, shape), for its header.
    var agent: Agent?
    /// A message to send as soon as the chat is on screen (Settings → Study → a book).
    var queuedPrompt: String?
    /// What agents' computers showed during this chat, by agent.
    private(set) var sandboxes: [SandboxFrame] = []
    private(set) var loaded = false
    private var started: Bool
    private var task: Task<Void, Never>?
    /// The reply was cut off (the app went away, the connection dropped) while the server kept
    /// going: load the chat again and pick the reply up when we can.
    private var needsCatchUp = false
    private var catchingUp = false
    /// The last message sent never reached the server (offline): Try again sends it again.
    private var undelivered: [String: JSONValue]?
    /// When the app went to the background, to tell a stream that may have died in its sleep.
    private var awayAt: Date?
    /// Tool input as it streams in, by tool call, so a half-written message can be shown.
    private var inputText: [String: String] = [:]
    private let session: SessionStore

    init(id: String = ChatModel.newId(), isNew: Bool, session: SessionStore, agentId: String? = nil) {
        self.id = id
        self.started = !isNew
        self.loaded = isNew
        self.session = session
        self.agentId = agentId
    }

    var uploading: Bool { attachments.contains { if case .uploading = $0.state { return true } else { return false } } }
    var busy: Bool { status == .sending || status == .streaming }

    // MARK: Attachments

    func attach(data: Data, filename: String, mediaType: String, preview: UIImage?) {
        let id = UUID().uuidString
        withAnimation(Motion.morph) {
            attachments.append(PendingAttachment(id: id, filename: filename, mediaType: mediaType, preview: preview, state: .uploading))
        }
        let api = session.api
        Task {
            struct Res: Decodable { struct A: Decodable { let url: String }; let attachment: A }
            let state: PendingAttachment.State
            do {
                let res = try await api.upload("/api/attachments", data: data, filename: filename, mediaType: mediaType, as: Res.self)
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

    // MARK: Loading

    private struct ConversationResponse: Decodable {
        struct Conv: Decodable { let title: String; let mode: String }
        struct Msg: Decodable { let id: String; let role: String; let parts: [JSONValue]; let metadata: JSONValue? }
        let conversation: Conv
        let messages: [Msg]
    }

    private var path: String { "/api/conversations/\(id)" }

    /// The chat as it was last time first (kept on the phone, so it shows at once and offline),
    /// then the server's copy, then any reply still running there.
    func load() async {
        guard started, !loaded else { return }
        if let cached = session.api.cached(path, as: ConversationResponse.self) {
            show(cached)
            loaded = true
        }
        do {
            let res = try await session.api.send(path, as: ConversationResponse.self, cache: true)
            if !busy { show(res) }
            loaded = true
            // A reply may still be running on the server (the chat was left while it worked).
            if !busy { resume() }
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {
            if Connectivity.isNetwork(error) {
                // Offline: the kept copy stays on screen; catch up when the connection is back.
                needsCatchUp = true
                if !loaded { status = .failed(Connectivity.describe(error)) }
            } else {
                status = .failed(Connectivity.describe(error))
            }
        }
    }

    private func show(_ res: ConversationResponse) {
        title = res.conversation.title
        studyMode = res.conversation.mode == "study"
        messages = res.messages.map { m in
            ChatMessage(id: m.id, role: m.role, parts: m.parts.enumerated().compactMap { Part.from($1, index: $0) }, metadata: MessageMetadata(m.metadata))
        }
    }

    // MARK: Catching up

    /// Loads the chat again and reconnects to a reply still running on the server. For a reply
    /// cut off by the app going away or the connection dropping: the server finished it (or is
    /// still on it) without us.
    func catchUp() async {
        guard started, needsCatchUp, !catchingUp else { return }
        catchingUp = true
        defer { catchingUp = false }
        do {
            let res = try await session.api.send(path, as: ConversationResponse.self, cache: true)
            needsCatchUp = false
            // A message that never left stays on screen, with its Try again.
            guard !busy, undelivered == nil else { return }
            show(res)
            loaded = true
            status = .idle
            resume()
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {
            if Connectivity.isNetwork(error) {
                status = .failed(Connectivity.offlineReply)
            } else {
                needsCatchUp = false
                status = .failed(Connectivity.describe(error))
            }
        }
    }

    /// The app went to the background.
    func appWentAway() {
        awayAt = .now
    }

    /// The app is back. A stream left running while it slept may be dead without knowing it:
    /// after more than a few seconds away, start again from the server's copy.
    func appCameBack() {
        let away = awayAt.map { Date.now.timeIntervalSince($0) } ?? 0
        awayAt = nil
        if busy && away > 5 {
            task?.cancel()
            task = nil
            status = .idle
            dropEmptyPending()
            needsCatchUp = true
        }
        if needsCatchUp { Task { await catchUp() } }
    }

    /// The connection is back.
    func connectionCameBack() {
        if needsCatchUp { Task { await catchUp() } }
    }

    /// Try again after a failure: catch up, send the message that never left, or answer again.
    func retry() {
        if let body = undelivered {
            undelivered = nil
            needsCatchUp = false
            stream(post: body)
        } else if needsCatchUp {
            Task { await catchUp() }
        } else {
            regenerate()
        }
    }

    /// What went wrong, for the error under the chat.
    var failure: String? {
        if case .failed(let message) = status { return message }
        return nil
    }

    private func dropEmptyPending() {
        if messages.last?.id == "pending", messages.last?.parts.isEmpty == true { messages.removeLast() }
    }

    // MARK: Sending

    /// Sends what's in the composer. Returns the new message's id.
    @discardableResult
    func send(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files: [(url: String, a: PendingAttachment)] = attachments.compactMap { a in
            if case .ready(let url) = a.state { return (url, a) } else { return nil }
        }
        guard !trimmed.isEmpty || !files.isEmpty, !busy, !uploading else { return nil }
        let msgId = String(ChatModel.newId().prefix(20))
        var shown: [Part] = files.enumerated().map { i, f in .file(id: "f\(i)", url: f.url, mediaType: f.a.mediaType, filename: f.a.filename) }
        var sent: [JSONValue] = files.map { f in
            .object(["type": .string("file"), "url": .string(f.url), "mediaType": .string(f.a.mediaType), "filename": .string(f.a.filename)])
        }
        if !trimmed.isEmpty {
            shown.append(.text(id: "t0", text: trimmed))
            sent.insert(.object(["type": .string("text"), "text": .string(trimmed)]), at: 0)
        }
        // No animation here: the new bubble flies in from the composer on its own (UserBubble).
        messages.append(ChatMessage(id: msgId, role: "user", parts: shown))
        withAnimation(Motion.morph) { attachments = [] }
        // You moved on from a message that never left.
        undelivered = nil
        var body = baseBody()
        body["message"] = .object(["id": .string(msgId), "role": .string("user"), "parts": .array(sent)])
        started = true
        stream(post: body)
        return msgId
    }

    /// Answers the last message again.
    func regenerate() {
        guard !busy, messages.contains(where: { $0.role == "user" }) else { return }
        if messages.last?.role == "assistant" { messages.removeLast() }
        var body = baseBody()
        body["regenerate"] = .bool(true)
        stream(post: body)
    }

    func respondToApproval(_ approvalId: String, approved: Bool) {
        var body = baseBody()
        body["approvals"] = .array([.object(["approvalId": .string(approvalId), "approved": .bool(approved)])])
        stream(post: body, continuing: true)
    }

    func answer(tool: String, toolCallId: String, output: [String: JSONValue]) {
        var body = baseBody()
        body["toolOutputs"] = .array([.object(["toolCallId": .string(toolCallId), "tool": .string(tool), "output": .object(output)])])
        stream(post: body, continuing: true)
    }

    /// Stops the reply here and on the server.
    func stop() {
        task?.cancel()
        task = nil
        status = .idle
        if messages.last?.id == "pending", messages.last?.parts.isEmpty == true { messages.removeLast() }
        let api = session.api
        let id = id
        Task { _ = try? await api.sendRaw("/api/chat/\(id)/stream", method: "DELETE") }
    }

    private func baseBody() -> [String: JSONValue] {
        var body: [String: JSONValue] = [
            "conversationId": .string(id),
            "mode": .string(studyMode ? "study" : "chat"),
        ]
        if let agentId { body["agentId"] = .string(agentId) }
        if let modelId { body["model"] = .string(modelId) }
        if useAgents || handwriting {
            body["tools"] = .object(["agents": .bool(useAgents), "handwriting": .bool(handwriting)])
        }
        return body
    }

    // MARK: Streaming

    private func stream(post body: [String: JSONValue], continuing: Bool = false) {
        do {
            var req = try session.api.request("/api/chat", method: "POST", json: JSONValue.object(body))
            req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            run(req, continuing: continuing, resuming: false)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    /// Picks up a reply that's still running on the server.
    private func resume() {
        guard let req = try? session.api.request("/api/chat/\(id)/stream") else { return }
        run(req, continuing: false, resuming: true)
    }

    private func run(_ request: URLRequest, continuing: Bool, resuming: Bool) {
        var req = request
        req.timeoutInterval = 900
        if !resuming { status = .sending }
        task?.cancel()
        let posted = resuming ? nil : (try? JSONDecoder().decode(JSONValue.self, from: request.httpBody ?? Data()))
        task = Task {
            var answered = false
            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: req)
                answered = true
                let code = (response as? HTTPURLResponse)?.statusCode ?? 200
                if resuming && code == 204 { return }
                if !(200..<300).contains(code) {
                    var data = Data()
                    for try await b in bytes { data.append(b) }
                    try APIClient.check(response, data)
                }
                if resuming { status = .streaming }
                if !continuing || messages.last?.role != "assistant" {
                    messages.append(ChatMessage(id: "pending", role: "assistant", parts: []))
                }
                status = .streaming
                for try await line in bytes.lines {
                    guard line.hasPrefix("data: ") else { continue }
                    let payload = line.dropFirst(6)
                    if payload == "[DONE]" { break }
                    guard let data = payload.data(using: .utf8), let chunk = try? JSONDecoder().decode(JSONValue.self, from: data) else { continue }
                    apply(chunk, resuming: resuming)
                }
                if case .failed = status {} else { status = .idle }
                if messages.last?.id == "pending", messages.last?.parts.isEmpty == true { messages.removeLast() }
            } catch is CancellationError {
                // Stopped on purpose.
            } catch let e as URLError where e.code == .cancelled {
                // Stopped on purpose.
            } catch let e as APIError where e.status == 401 {
                status = .idle
                session.handleUnauthorized(e)
            } catch {
                guard Connectivity.isNetwork(error) else {
                    if resuming { status = .idle; return }
                    status = .failed(Connectivity.describe(error))
                    return
                }
                dropEmptyPending()
                if !answered && !resuming, case .object(let body)? = posted {
                    // Never reached the server (offline): keep the message and offer to send it again.
                    undelivered = body
                    status = .failed(Connectivity.describe(error))
                    return
                }
                // Cut off mid-reply (the app went away, the connection dropped). The server keeps
                // going: catch up with it instead of calling it a failure.
                needsCatchUp = true
                status = .idle
                try? await Task.sleep(for: .seconds(1))
                if Connectivity.shared.online {
                    await catchUp()
                } else {
                    status = .failed(Connectivity.offlineReply)
                }
            }
        }
    }

    private func mutateLast(_ f: (inout ChatMessage) -> Void) {
        guard let i = messages.indices.last, messages[i].role == "assistant" else { return }
        f(&messages[i])
    }

    private func apply(_ c: JSONValue, resuming: Bool) {
        guard let type = c["type"]?.string else { return }
        switch type {
        case "start":
            if let id = c["messageId"]?.string {
                // Replaying a reply that was saved part-way: the live copy replaces it.
                if resuming, let old = messages.dropLast().lastIndex(where: { $0.id == id }) { messages.remove(at: old) }
                mutateLast { $0.id = id }
            }
            mutateLast { $0.metadata.merge(c["messageMetadata"]) }
        case "message-metadata", "finish":
            mutateLast { $0.metadata.merge(c["messageMetadata"]) }
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
            let id = c["id"]?.string
            let delta = c["delta"]?.string ?? ""
            mutateLast { m in
                if let i = m.parts.lastIndex(where: { if case .reasoning(let pid, _) = $0 { return pid == id || id == nil } else { return false } }),
                   case .reasoning(let pid, let t) = m.parts[i] {
                    m.parts[i] = .reasoning(id: pid, text: t + delta)
                } else {
                    m.parts.append(.reasoning(id: id ?? UUID().uuidString, text: delta))
                }
            }
        case "tool-input-start", "tool-input-delta", "tool-input-available", "tool-input-error", "tool-output-available",
             "tool-output-error", "tool-approval-request", "tool-output-denied":
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
        case "data-route":
            let d = c["data"]
            mutateLast { m in
                m.parts.removeAll { if case .route = $0 { return true } else { return false } }
                m.parts.insert(.route(route: d?["route"]?.string ?? "direct", reason: d?["reason"]?.string ?? "", model: d?["model"]?.string), at: 0)
            }
        case "data-title":
            if let t = c["data"]?["title"]?.string { withAnimation(Motion.morph) { title = t } }
        case "data-sandbox":
            if let d = c["data"] { pushFrame(d) }
        case "error":
            status = .failed(c["errorText"]?.string ?? "Something went wrong")
        default:
            break
        }
    }

    private func updateTool(type: String, chunk c: JSONValue) {
        guard let callId = c["toolCallId"]?.string else { return }
        if type == "tool-input-delta" {
            inputText[callId, default: ""] += c["inputTextDelta"]?.string ?? ""
        }
        let partial = type == "tool-input-delta" ? Self.partialJSON(inputText[callId] ?? "") : nil
        mutateLast { m in
            let idx = m.parts.firstIndex { $0.tool?.id == callId }
            var t = idx.flatMap { m.parts[$0].tool } ?? ToolCall(id: callId, name: c["toolName"]?.string ?? "tool", state: "input-streaming")
            if let name = c["toolName"]?.string { t.name = name }
            switch type {
            case "tool-input-delta": if let partial { t.input = partial }
            case "tool-input-available": t.state = "input-available"; t.input = c["input"]
            case "tool-input-error": t.state = "output-error"; t.error = c["errorText"]?.string
            case "tool-output-available": t.state = "output-available"; t.output = c["output"]
            case "tool-output-error": t.state = "output-error"; t.error = c["errorText"]?.string
            case "tool-approval-request": t.state = "approval-requested"; t.approvalId = c["approvalId"]?.string
            case "tool-output-denied": t.state = "output-denied"
            default: break
            }
            if let idx { m.parts[idx] = .tool(t) } else { m.parts.append(.tool(t)) }
        }
    }

    /// Reads JSON that is still being written, by closing what's open.
    static func partialJSON(_ s: String) -> JSONValue? {
        var stack: [Character] = []
        var inString = false
        var escaped = false
        for ch in s {
            if inString {
                if escaped { escaped = false } else if ch == "\\" { escaped = true } else if ch == "\"" { inString = false }
                continue
            }
            switch ch {
            case "\"": inString = true
            case "{": stack.append("}")
            case "[": stack.append("]")
            case "}", "]": if !stack.isEmpty { stack.removeLast() }
            default: break
            }
        }
        var fixed = s
        if escaped { fixed.removeLast() }
        if inString { fixed += "\"" }
        let trimmed = fixed.trimmingCharacters(in: .whitespaces)
        if trimmed.hasSuffix(",") || trimmed.hasSuffix(":") { fixed = String(trimmed.dropLast()) + (trimmed.hasSuffix(":") ? "null" : "") }
        fixed += String(stack.reversed())
        guard let data = fixed.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func pushFrame(_ d: JSONValue) {
        guard let agentId = d["agentId"]?.string else { return }
        var f = sandboxes.first { $0.agentId == agentId } ?? SandboxFrame(agentId: agentId, agentName: d["agentName"]?.string ?? "Agent", color: d["color"]?.string ?? "#8a8a8a")
        if let x = d["agentName"]?.string { f.agentName = x }
        if let x = d["color"]?.string { f.color = x }
        if let x = d["shape"]?.string { f.shape = x }
        if let x = d["url"]?.string { f.url = x }
        if let x = d["title"]?.string { f.title = x }
        if let x = d["screenshot"]?.string { f.screenshot = x }
        if let t = d["terminal"] {
            f.terminal.append(.init(command: t["command"]?.string ?? "", output: t["output"]?.string ?? "", exitCode: t["exitCode"]?.int ?? 0))
            f.terminal = Array(f.terminal.suffix(30))
        }
        if let i = sandboxes.firstIndex(where: { $0.agentId == agentId }) { sandboxes[i] = f } else { sandboxes.append(f) }
    }

    nonisolated static func newId() -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        return String((0..<21).map { _ in alphabet.randomElement()! })
    }
}
