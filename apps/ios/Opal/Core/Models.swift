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
    let name: String
    let color: String
    let shape: String?
    let threadId: String?
    let preview: String?
    let running: Bool?
}

struct AgentRun: Hashable {
    struct Step: Hashable { let kind: String; let label: String; let status: String }
    let runId: String
    let name: String
    let color: String
    let task: String
    let status: String
    let result: String?
    let steps: [Step]

    init(_ v: JSONValue) {
        runId = v["runId"]?.string ?? UUID().uuidString
        name = v["name"]?.string ?? "Agent"
        color = v["color"]?.string ?? "#71717a"
        task = v["task"]?.string ?? ""
        status = v["status"]?.string ?? "running"
        result = v["result"]?.string
        steps = (v["steps"]?.array ?? []).map {
            Step(kind: $0["kind"]?.string ?? "", label: $0["label"]?.string ?? $0["text"]?.string ?? "", status: $0["status"]?.string ?? "")
        }
    }
}

enum Part: Hashable, Identifiable {
    case text(id: String, text: String)
    case reasoning(id: String, text: String)
    case tool(id: String, name: String, state: String, input: JSONValue?, output: JSONValue?, error: String?, approvalId: String?)
    case agent(AgentRun)
    case agentMessage(id: String, from: String, to: String, text: String)
    case route(route: String, reason: String)
    /// An attachment on a user message. `url` is Opal's own link (needs the session to load).
    case file(id: String, url: String, mediaType: String, filename: String)

    var id: String {
        switch self {
        case .text(let id, _), .reasoning(let id, _): return id
        case .tool(let id, _, _, _, _, _, _): return id
        case .agent(let run): return "agent-\(run.runId)"
        case .agentMessage(let id, _, _, _): return id
        case .route: return "route"
        case .file(let id, _, _, _): return id
        }
    }

    /// Builds a part from a stored UIMessage part (GET /api/conversations/:id).
    static func from(_ v: JSONValue, index: Int) -> Part? {
        guard let type = v["type"]?.string else { return nil }
        switch type {
        case "text": return .text(id: "t\(index)", text: v["text"]?.string ?? "")
        case "reasoning": return .reasoning(id: "r\(index)", text: v["text"]?.string ?? "")
        case "file": return .file(id: "f\(index)", url: v["url"]?.string ?? "", mediaType: v["mediaType"]?.string ?? "", filename: v["filename"]?.string ?? "File")
        case "data-agent": return v["data"].map { .agent(AgentRun($0)) }
        case "data-route": return .route(route: v["data"]?["route"]?.string ?? "direct", reason: v["data"]?["reason"]?.string ?? "")
        case "data-agent-msg":
            let d = v["data"]
            return .agentMessage(id: "m\(index)", from: d?["from"]?["name"]?.string ?? "", to: d?["to"]?["name"]?.string ?? "", text: d?["text"]?.string ?? "")
        default:
            guard type.hasPrefix("tool-") else { return nil }
            return .tool(
                id: v["toolCallId"]?.string ?? "tool\(index)",
                name: String(type.dropFirst(5)),
                state: v["state"]?.string ?? "",
                input: v["input"],
                output: v["output"],
                error: v["errorText"]?.string,
                approvalId: v["approval"]?["id"]?.string
            )
        }
    }
}

struct ChatMessage: Identifiable, Hashable {
    var id: String
    let role: String
    var parts: [Part]

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
