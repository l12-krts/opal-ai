import Foundation

struct Conversation: Decodable, Identifiable, Hashable {
    let id: String
    var title: String
    let mode: String
    let agentId: String?
    let pinned: Bool
    let updatedAt: Date
}

/// An agent is a name, a color and a shape. Each has one thread (`threadId`, created on first open).
struct Agent: Decodable, Identifiable, Hashable {
    let id: String
    var name: String
    var color: String
    var shape: String?
    var threadId: String?
    var preview: String?
    var running: Bool?
    var activityAt: Date?
    var ephemeral: Bool?
}

/// Who sent a message to an agent: Opal or another agent.
struct AgentSender: Hashable, Sendable {
    let kind: String
    let name: String
    let color: String?
    let shape: String?
    let agentId: String?

    init?(_ v: JSONValue?) {
        guard let v, let name = v["name"]?.string else { return nil }
        kind = v["kind"]?.string ?? "agent"
        self.name = name
        color = v["color"]?.string
        shape = v["shape"]?.string
        agentId = v["agentId"]?.string
    }
}

/// Live state of one agent run (one message to an agent and its reply), from `data-agent` parts.
struct AgentRun: Hashable {
    let runId: String
    let toolCallId: String?
    let agentId: String
    let threadId: String?
    let name: String
    let color: String
    let shape: String?
    let ephemeral: Bool
    let from: AgentSender?
    let task: String
    let status: String
    let current: String?
    let result: String?

    init(_ v: JSONValue) {
        runId = v["runId"]?.string ?? UUID().uuidString
        toolCallId = v["toolCallId"]?.string
        agentId = v["agentId"]?.string ?? ""
        threadId = v["threadId"]?.string
        name = v["name"]?.string ?? "Agent"
        color = v["color"]?.string ?? "#8a8a8a"
        shape = v["shape"]?.string
        ephemeral = v["ephemeral"]?.bool ?? false
        from = AgentSender(v["from"])
        task = v["task"]?.string ?? ""
        status = v["status"]?.string ?? "running"
        current = v["current"]?.string
        result = v["result"]?.string
    }
}

/// One tool call in an assistant message, as the AI SDK streams it.
struct ToolCall: Hashable {
    let id: String
    var name: String
    /// input-streaming, input-available, approval-requested, output-available, output-error, output-denied
    var state: String
    var input: JSONValue?
    var output: JSONValue?
    var error: String?
    var approvalId: String?

    var running: Bool { state == "input-streaming" || state == "input-available" }
    var failed: Bool { state == "output-error" }
}

enum Part: Hashable, Identifiable {
    case text(id: String, text: String)
    case reasoning(id: String, text: String)
    case tool(ToolCall)
    case agent(AgentRun)
    case route(route: String, reason: String, model: String?)
    /// An attachment on a user message. `url` is Opal's own link (needs the session to load).
    case file(id: String, url: String, mediaType: String, filename: String)

    var id: String {
        switch self {
        case .text(let id, _), .reasoning(let id, _): return id
        case .tool(let t): return t.id
        case .agent(let run): return "agent-\(run.runId)"
        case .route: return "route"
        case .file(let id, _, _, _): return id
        }
    }

    var tool: ToolCall? { if case .tool(let t) = self { return t } else { return nil } }

    /// Builds a part from a stored UIMessage part (GET /api/conversations/:id).
    static func from(_ v: JSONValue, index: Int) -> Part? {
        guard let type = v["type"]?.string else { return nil }
        switch type {
        case "text": return .text(id: "t\(index)", text: v["text"]?.string ?? "")
        case "reasoning": return .reasoning(id: "r\(index)", text: v["text"]?.string ?? "")
        case "file": return .file(id: "f\(index)", url: v["url"]?.string ?? "", mediaType: v["mediaType"]?.string ?? "", filename: v["filename"]?.string ?? "File")
        case "data-agent": return v["data"].map { .agent(AgentRun($0)) }
        case "data-route":
            let d = v["data"]
            return .route(route: d?["route"]?.string ?? "direct", reason: d?["reason"]?.string ?? "", model: d?["model"]?.string)
        case "dynamic-tool":
            return .tool(ToolCall(
                id: v["toolCallId"]?.string ?? "tool\(index)",
                name: v["toolName"]?.string ?? "tool",
                state: v["state"]?.string ?? "",
                input: v["input"], output: v["output"], error: v["errorText"]?.string,
                approvalId: v["approval"]?["id"]?.string
            ))
        default:
            guard type.hasPrefix("tool-") else { return nil }
            return .tool(ToolCall(
                id: v["toolCallId"]?.string ?? "tool\(index)",
                name: String(type.dropFirst(5)),
                state: v["state"]?.string ?? "",
                input: v["input"], output: v["output"], error: v["errorText"]?.string,
                approvalId: v["approval"]?["id"]?.string
            ))
        }
    }
}

/// What the server tells us about a message: the model, token counts, timing, and for a message
/// an agent received, who sent it.
struct MessageMetadata: Hashable {
    var model: String?
    var inputTokens: Int?
    var outputTokens: Int?
    var reasoningTokens: Int?
    var startedAt: Double?
    var finishedAt: Double?
    var from: AgentSender?

    init(_ v: JSONValue? = nil) {
        merge(v)
    }

    mutating func merge(_ v: JSONValue?) {
        guard let v else { return }
        if let x = v["model"]?.string { model = x }
        if let x = v["inputTokens"]?.int { inputTokens = x }
        if let x = v["outputTokens"]?.int { outputTokens = x }
        if let x = v["reasoningTokens"]?.int { reasoningTokens = x }
        if let x = v["startedAt"]?.number { startedAt = x }
        if let x = v["finishedAt"]?.number { finishedAt = x }
        if let x = AgentSender(v["from"]) { from = x }
    }

    /// "model · 120 in · 340 out · 80 reasoning · 2.4s", for nerd mode.
    var stats: String {
        var out: [String] = []
        if let model { out.append(model.split(separator: ":").dropFirst().joined(separator: ":")) }
        if let inputTokens { out.append("\(inputTokens) in") }
        if let outputTokens { out.append("\(outputTokens) out") }
        if let reasoningTokens, reasoningTokens > 0 { out.append("\(reasoningTokens) reasoning") }
        if let s = startedAt, let f = finishedAt { out.append(String(format: "%.1fs", (f - s) / 1000)) }
        return out.filter { !$0.isEmpty }.joined(separator: "  ·  ")
    }
}

struct ChatMessage: Identifiable, Hashable {
    var id: String
    let role: String
    var parts: [Part]
    var metadata = MessageMetadata()
    /// What the list keys the message's view by. Unlike `id` it never changes: a reply starts as
    /// "pending" and gets its real id from the server part-way through, and a new key then would
    /// rebuild the whole message on screen (the text jumps and fades in again).
    let key: String

    init(id: String, role: String, parts: [Part], metadata: MessageMetadata = MessageMetadata()) {
        self.id = id
        self.role = role
        self.parts = parts
        self.metadata = metadata
        self.key = id == "pending" ? "pending-\(UUID().uuidString)" : id
    }

    var text: String {
        parts.compactMap { if case .text(_, let t) = $0 { return t } else { return nil } }.joined(separator: "\n\n")
    }
}

/// A model the composer can pick (GET /api/settings → models). Opal's own tiers come first.
struct ModelInfo: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let providerLabel: String
    let tier: Bool?
    let description: String?
}

extension Date {
    /// "now", "5m", "3h", "Tue", "4 Mar": how the web lists recent activity.
    var shortRelative: String {
        let s = Date.now.timeIntervalSince(self)
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 { return "\(Int(s / 3600))h" }
        if s < 6 * 86400 { return formatted(.dateTime.weekday(.abbreviated)) }
        return formatted(.dateTime.day().month(.abbreviated))
    }
}
