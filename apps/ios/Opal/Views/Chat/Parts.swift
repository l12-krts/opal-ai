import SwiftUI
import UIKit

// The parts of an assistant message, as the web lays them out (components/chat/message.tsx):
// runs of thinking and tool steps fold into one quiet "work" row, agent messages get their own
// rows, and cards (quizzes, secrets, generated UI, handwriting) stand on their own.

/// Tools that show as their own card instead of a step in the work log.
let cardTools: Set<String> = ["request_secret", "ask_user", "render_ui", "create_quiz", "create_flashcards", "write_by_hand", "remember", "forget", "share_file"]
/// Tools that only show when they fail.
let hiddenTools: Set<String> = ["list_agents", "list_secrets"]
/// Tools that message an agent.
let agentTools: Set<String> = ["message_agent", "spawn_agent", "study_helper", "delegate", "ask_agent"]

enum PartGroup: Identifiable {
    case work([Part], start: Int, end: Int)
    case agents([ToolCall], start: Int)
    case single(Part, start: Int)

    var id: Int {
        switch self {
        case .work(_, let s, _), .agents(_, let s), .single(_, let s): return s
        }
    }

    static func group(_ parts: [Part]) -> [PartGroup] {
        var out: [PartGroup] = []
        for (i, part) in parts.enumerated() {
            if case .agent = part { continue }
            if let t = part.tool {
                if agentTools.contains(t.name), t.state != "approval-requested" {
                    if case .agents(var list, let s) = out.last {
                        list.append(t)
                        out[out.count - 1] = .agents(list, start: s)
                    } else {
                        out.append(.agents([t], start: i))
                    }
                    continue
                }
                if hiddenTools.contains(t.name), t.state != "output-error" { continue }
            }
            let isStep: Bool = {
                if case .reasoning = part { return true }
                guard let t = part.tool else { return false }
                return !cardTools.contains(t.name) && !hiddenTools.contains(t.name) && t.state != "approval-requested"
            }()
            if isStep, case .work(var list, let s, _) = out.last {
                list.append(part)
                out[out.count - 1] = .work(list, start: s, end: i)
            } else if isStep {
                out.append(.work([part], start: i, end: i))
            } else {
                out.append(.single(part, start: i))
            }
        }
        return out
    }
}

/// An assistant message: its parts, then (when done) copy, retry and, in nerd mode, the stats.
struct AssistantMessageView: View {
    let message: ChatMessage
    let isLast: Bool
    let streaming: Bool
    let errored: Bool
    let model: ChatModel
    @Environment(SessionStore.self) private var session

    var body: some View {
        let parts = message.parts
        let lastText = parts.lastIndex { if case .text = $0 { return true } else { return false } }
        let hasVisible = parts.contains {
            switch $0 {
            case .text, .reasoning, .tool: return true
            default: return false
            }
        }
        let delegated = parts.contains { $0.tool.map { agentTools.contains($0.name) } ?? false }
        var runs: [String: AgentRun] = [:]
        for p in parts { if case .agent(let r) = p, let tc = r.toolCallId { runs[tc] = r } }
        let text = message.text

        return VStack(alignment: .leading, spacing: 14) {
            ForEach(PartGroup.group(parts)) { g in
                switch g {
                case .work(let list, _, let end):
                    let active = streaming && end == parts.count - 1
                    if list.count == 1, case .reasoning(_, let t) = list[0] {
                        ReasoningView(text: t, streaming: active, nerd: session.nerdMode)
                    } else {
                        WorkGroupView(parts: list, active: active, nerd: session.nerdMode)
                    }
                case .agents(let calls, _):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(calls, id: \.id) { t in
                            AgentMessageTool(call: t, streaming: streaming, run: runs[t.id], model: model)
                        }
                    }
                case .single(let part, let i):
                    switch part {
                    case .route(let route, let reason, let m):
                        RouteChip(route: route, reason: reason, model: m, delegated: delegated, nerd: session.nerdMode)
                    case .text(_, let t):
                        if streaming && i == lastText {
                            MarkdownView(text: t)
                        } else {
                            MarkdownView(text: t)
                        }
                    case .tool(let t):
                        ToolPartView(call: t, streaming: streaming, model: model)
                    default:
                        EmptyView()
                    }
                }
            }

            if streaming && !hasVisible {
                ThinkingRow()
            }

            if errored {
                HStack(spacing: 6) {
                    Text(model.failure ?? "Opal could not answer.").foregroundStyle(Color.danger)
                    Button("Try again") { model.retry() }
                        .underline()
                        .foregroundStyle(Color.danger)
                        .buttonStyle(PressableStyle())
                }
                .font(.system(size: 14))
            }

            if !streaming && (!text.isEmpty || session.nerdMode) && !errored {
                MessageActions(text: text, isLast: isLast, stats: session.nerdMode ? message.metadata.stats : "", model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Copy, retry and stats under an answer. Always visible: there's no hover on a phone.
private struct MessageActions: View {
    let text: String
    let isLast: Bool
    let stats: String
    let model: ChatModel
    @State private var copied = false

    var body: some View {
        HStack(spacing: 2) {
            if !text.isEmpty {
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.4)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 34, height: 30)
                        .contentShape(.rect)
                }
                .accessibilityLabel(copied ? "Copied" : "Copy")
                .sensoryFeedback(.success, trigger: copied) { _, now in now }
            }
            if isLast {
                Button { model.regenerate() } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(width: 34, height: 30)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Retry")
            }
            if !stats.isEmpty {
                Text(stats)
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .padding(.leading, 8)
            }
        }
        .font(.system(size: 14))
        .foregroundStyle(.secondary)
        .buttonStyle(PressableStyle(scale: 0.9))
        .padding(.leading, -8)
        .padding(.top, -4)
    }
}

/// While Opal hasn't said anything yet: the mark, breathing, and "Thinking" with a light
/// sweeping across it (the web's PendingAssistant). With `error`, the way to try again.
struct ThinkingRow: View {
    var error = false
    /// What went wrong; "Opal could not answer." when not given.
    var message: String?
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            if error {
                OpalMark(size: 16).foregroundStyle(.secondary)
                // Longer reasons ("You're offline. Opal keeps working…") wrap, with Try again under them.
                VStack(alignment: .leading, spacing: 4) {
                    Text(message ?? "Opal could not answer.")
                        .foregroundStyle(Color.danger)
                        .fixedSize(horizontal: false, vertical: true)
                    if let onRetry {
                        Button("Try again", action: onRetry).underline().foregroundStyle(Color.danger).buttonStyle(PressableStyle())
                    }
                }
            } else {
                WorkingMark(size: 16).foregroundStyle(.secondary)
                ShimmerText(text: "Thinking")
            }
        }
        .font(.system(size: 15))
        .frame(minHeight: 24)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Disclosure

/// A quiet row that opens to show more: an icon, a label, and a chevron that turns.
struct DisclosureRow<Label: View, Content: View>: View {
    var initiallyOpen = false
    var bordered = true
    @ViewBuilder var label: Label
    @ViewBuilder var content: Content
    @State private var open: Bool?

    init(initiallyOpen: Bool = false, bordered: Bool = true, @ViewBuilder label: () -> Label, @ViewBuilder content: () -> Content) {
        self.initiallyOpen = initiallyOpen
        self.bordered = bordered
        self.label = label()
        self.content = content()
    }

    var body: some View {
        let isOpen = open ?? initiallyOpen
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.28)) { open = !isOpen }
            } label: {
                HStack(spacing: 7) {
                    label
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                }
                .font(.system(size: 14.5))
                .foregroundStyle(.secondary)
                .frame(minHeight: 28)
                .contentShape(.rect)
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            if isOpen {
                VStack(alignment: .leading, spacing: 8) { content }
                    .padding(.leading, bordered ? 12 : 22)
                    .overlay(alignment: .leading) {
                        if bordered { Rectangle().fill(Color.primary.opacity(0.12)).frame(width: 1) }
                    }
                    .padding(.leading, bordered ? 4 : 0)
                    .padding(.top, 6)
                    .transition(.opacity.combined(with: .offset(y: -4)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Reasoning

/// One stretch of thinking: "Thinking" while it streams, "Thought for 4s" after; opens to the text.
struct ReasoningView: View {
    let text: String
    let streaming: Bool
    let nerd: Bool
    @State private var startedAt = Date.now
    @State private var seconds: Int?

    var body: some View {
        DisclosureRow(initiallyOpen: nerd) {
            Image(systemName: "brain").font(.system(size: 14))
            if streaming {
                ShimmerText(text: "Thinking")
            } else {
                Text(seconds.map { "Thought for \($0)s" } ?? "Thought")
            }
        } content: {
            ScrollView {
                Text(text.trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 420)
            .fixedSize(horizontal: false, vertical: true)
        }
        .onChange(of: streaming) { _, now in
            if !now { seconds = max(1, Int(Date.now.timeIntervalSince(startedAt).rounded())) }
        }
    }
}

// MARK: Work group

/// Thinking and tool steps folded into one row: the current step while it works, then a summary.
struct WorkGroupView: View {
    let parts: [Part]
    let active: Bool
    let nerd: Bool

    var body: some View {
        let tools = parts.compactMap(\.tool)
        let current: String = {
            guard let last = parts.last else { return "Working" }
            if let t = last.tool { return describeTool(t.name, t.input).label }
            return "Thinking"
        }()
        var seen = Set<String>()
        let labels = tools.map { verbOf(describeTool($0.name, $0.input).label) }.filter { seen.insert($0).inserted }
        let summary = labels.isEmpty ? "Thought" : labels.prefix(3).joined(separator: ", ") + (labels.count > 3 ? " and \(labels.count - 3) more" : "")

        DisclosureRow(initiallyOpen: nerd) {
            if active {
                ShimmerText(text: current).lineLimit(1)
            } else {
                Text(summary).lineLimit(1)
                if !tools.isEmpty {
                    Text("\(tools.count) step\(tools.count == 1 ? "" : "s")")
                        .font(.system(size: 13).monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }
        } content: {
            ForEach(parts) { p in
                switch p {
                case .reasoning(_, let text):
                    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty {
                        Text(t)
                            .font(.system(size: 14))
                            .lineSpacing(2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(nerd ? nil : 3)
                    }
                case .tool(let t):
                    ToolRow(call: t, streaming: active, nerd: nerd)
                default:
                    EmptyView()
                }
            }
        }
    }

    /// "Searched study material for x" → "Searched study material".
    private func verbOf(_ label: String) -> String {
        var s = label
        if let r = s.range(of: " for \"") { s = String(s[..<r.lowerBound]) }
        if s.hasPrefix("Ran ") { return "Ran commands" }
        if s.hasPrefix("Opened ") || s.hasPrefix("Browser ") { return "Used the browser" }
        if (s.hasPrefix("Read ") || s.hasPrefix("Wrote ")), let last = s.split(separator: " ").last, s.split(separator: " ").count == 2, last.contains(".") {
            return "Worked with files"
        }
        return s
    }
}

/// What a tool call did, in words, and its icon.
func describeTool(_ name: String, _ input: JSONValue?) -> (icon: String, label: String) {
    func host(_ u: String?) -> String { u.flatMap { URL(string: $0)?.host() } ?? "page" }
    switch name {
    case "browser":
        let action = input?["action"]?.string
        if action == "goto", let url = input?["url"]?.string { return ("safari", "Opened \(host(url))") }
        let labels = ["read": "Read the page", "click": "Clicked on the page", "type": "Typed on the page", "scroll": "Scrolled", "back": "Went back", "press": "Pressed a key"]
        return ("safari", action.flatMap { labels[$0] } ?? "Used the browser")
    case "terminal":
        let first = (input?["command"]?.string ?? "").split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return ("terminal", "Ran \(first.prefix(60))\(first.count > 60 ? "…" : "")")
    case "read_file": return ("doc", "Read \(input?["path"]?.string ?? "file")")
    case "write_file": return ("doc", "Wrote \(input?["path"]?.string ?? "file")")
    case "list_files": return ("doc", "Listed files")
    case "share_file": return ("paperclip", "Attached \((input?["path"]?.string ?? "a file").split(separator: "/").last.map(String.init) ?? "a file")")
    case "read_webpage": return ("globe", "Read \(host(input?["url"]?.string))")
    case "use_skill": return ("wand.and.stars", "Used the \(input?["name"]?.string ?? "") skill")
    case "remember": return ("brain", "Saved to memory")
    case "forget": return ("brain", "Removed from memory")
    case "code_overview": return ("chevron.left.forwardslash.chevron.right", "Checked Opal Code")
    case "code_start": return ("chevron.left.forwardslash.chevron.right", "Started a \(input?["agent"]?.string == "codex" ? "Codex" : "Claude Code") thread in Opal Code")
    case "code_message": return ("chevron.left.forwardslash.chevron.right", "Messaged a coding thread")
    case "code_read": return ("chevron.left.forwardslash.chevron.right", "Read a coding thread")
    case "web_search": return ("magnifyingglass", "Searched \(input?["kind"]?.string == "news" ? "the news" : "the web") for \"\(input?["query"]?.string ?? "")\"")
    case "study_search": return ("magnifyingglass", "Searched study material for \"\(input?["query"]?.string ?? "")\"")
    case "study_browse": return ("book", "Browsed study material")
    case "study_read": return ("book", "Read study material")
    default:
        if name.hasPrefix("COMPOSIO_") {
            let slugs = (input?["tools"]?.array ?? []).compactMap { $0["tool_slug"]?.string }
            let pretty = name.dropFirst("COMPOSIO_".count).lowercased().replacingOccurrences(of: "_", with: " ")
            return ("powerplug", slugs.isEmpty ? pretty : slugs.map(prettySlug).joined(separator: ", "))
        }
        return ("wrench.adjustable", name.replacingOccurrences(of: "_", with: " "))
    }
}

/// "GMAIL_SEND_EMAIL" → "Gmail: send email".
func prettySlug(_ slug: String) -> String {
    var s = slug.lowercased().split(separator: "_").map(String.init)
    guard !s.isEmpty else { return slug }
    let app = s.removeFirst()
    return "\(app.prefix(1).uppercased())\(app.dropFirst()): \(s.joined(separator: " "))"
}

/// One tool step: what it did, whether it's running or failed; opens to the details.
struct ToolRow: View {
    let call: ToolCall
    let streaming: Bool
    let nerd: Bool

    var body: some View {
        let d = describeTool(call.name, call.input)
        let running = call.running
        let stale = running && !streaming
        let failed = call.failed || (call.state == "output-available" && call.output?["ok"]?.bool == false)
        let denied = call.state == "output-denied"
        DisclosureRow(bordered: false) {
            Image(systemName: d.icon).font(.system(size: 13.5)).frame(width: 16)
            if running && !stale { ShimmerText(text: d.label).lineLimit(1) } else { Text(d.label).lineLimit(1) }
            if running && !stale { ProgressView().controlSize(.mini) }
            if failed { Image(systemName: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(Color.danger) }
            if denied { Text("denied").font(.system(size: 12.5)).foregroundStyle(.tertiary) }
            if call.state == "output-available" && !failed && nerd {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.success)
            }
        } content: {
            if failed {
                Text(call.error ?? call.output?["error"]?.string ?? "Failed").font(.system(size: 13)).foregroundStyle(Color.danger)
            }
            if call.name == "web_search", let results = call.output?["results"]?.array {
                SearchResults(results: results)
            }
            if call.name == "terminal", let out = call.output?["output"]?.string, !out.isEmpty {
                CodeText(text: out)
            }
            if nerd || (call.name != "terminal" && call.name != "web_search") {
                let shown: JSONValue? = nerd
                    ? .object(["input": call.input ?? .null, "output": call.output ?? .null])
                    : summarize(call.output)
                if let shown, shown != .null { CodeText(text: shown.pretty, muted: true) }
            }
        }
    }

    /// Long strings cut at 600 characters, long lists at 8 items.
    private func summarize(_ v: JSONValue?) -> JSONValue? {
        guard case .object(let o)? = v else { return v }
        var copy: [String: JSONValue] = [:]
        for (k, x) in o {
            switch x {
            case .string(let s) where s.count > 600: copy[k] = .string(String(s.prefix(600)) + "…")
            case .array(let a) where a.count > 8: copy[k] = .array(Array(a.prefix(8)) + [.string("…\(a.count - 8) more")])
            default: copy[k] = x
            }
        }
        return .object(copy)
    }
}

/// Monospaced output in a box that scrolls (up to 260pt tall).
struct CodeText: View {
    let text: String
    var muted = false

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(text)
                .font(.system(size: muted ? 11.5 : 12, design: .monospaced))
                .lineSpacing(2)
                .foregroundStyle(muted ? .secondary : .primary)
                .textSelection(.enabled)
                .padding(10)
                .fixedSize()
        }
        .frame(maxHeight: 260)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.wash, in: .rect(cornerRadius: 10, style: .continuous))
    }
}

private struct SearchResults: View {
    let results: [JSONValue]
    @Environment(\.openURL) private var openURL

    var body: some View {
        if results.isEmpty {
            Text("No results.").font(.system(size: 13)).foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(results.enumerated()), id: \.offset) { _, r in
                    Button {
                        if let u = r["url"]?.string.flatMap(URL.init(string:)) { openURL(u) }
                    } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r["title"]?.string ?? "").font(.system(size: 14)).foregroundStyle(.primary).lineLimit(1)
                            Text([r["source"]?.string, r["age"]?.string].compactMap { $0 }.joined(separator: " · "))
                                .font(.system(size: 12.5)).foregroundStyle(.tertiary).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                }
            }
        }
    }
}

// MARK: Memory

/// "Memory updated": opens to show what was saved or removed.
struct MemoryRow: View {
    let call: ToolCall
    let forgot: Bool
    @Environment(Shell.self) private var shell

    var body: some View {
        let failed = call.failed || call.output?["ok"]?.bool == false
        let fact = call.output?["fact"]?.string ?? call.input?["fact"]?.string ?? ""
        let label = failed ? "Couldn't update memory" : forgot ? "Removed from memory" : "Memory updated"
        DisclosureRow {
            Image(systemName: "brain").font(.system(size: 14))
            if call.running { ShimmerText(text: label) } else { Text(label) }
        } content: {
            if !fact.isEmpty {
                Text(fact).font(.system(size: 14.5)).strikethrough(forgot).foregroundStyle(.primary.opacity(0.85))
            }
            if failed {
                Text(call.output?["error"]?.string ?? call.error ?? "").font(.system(size: 13)).foregroundStyle(Color.danger)
            }
            Button("Manage memory") { shell.open(.settings(.memory)) }
                .font(.system(size: 13))
                .underline()
                .foregroundStyle(.secondary)
                .buttonStyle(PressableStyle())
        }
    }
}

// MARK: Route

/// Whether Opal handed the turn to agents (or, in nerd mode, why it answered directly).
struct RouteChip: View {
    let route: String
    let reason: String
    let model: String?
    let delegated: Bool
    let nerd: Bool

    var body: some View {
        if delegated || nerd {
            HStack(spacing: 6) {
                Image(systemName: delegated ? "person.2" : "arrow.turn.down.right").font(.system(size: 12))
                Text(delegated ? "Delegated to agents" : "Answered directly")
                if nerd {
                    Text([model?.split(separator: ":").dropFirst().joined(separator: ":"), reason.isEmpty ? nil : reason].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Color.wash, in: Capsule())
        }
    }
}

// MARK: Agent messages

/// "Sent message to Scout" (opens to who and what), then "Received message from Scout".
struct AgentMessageTool: View {
    let call: ToolCall
    let streaming: Bool
    let run: AgentRun?
    let model: ChatModel
    @Environment(Shell.self) private var shell

    private static let gray = "#8a8a8a"

    var body: some View {
        let out = call.state == "output-available" ? call.output : nil
        let outAgent = out?["agent"]
        let name: String = outAgent?["name"]?.string ?? run?.name ?? targetName
        let color: String = outAgent?["color"]?.string ?? run?.color ?? Self.gray
        let shape: String? = outAgent?["shape"]?.string ?? run?.shape
        let agentId: String? = outAgent?["id"]?.string ?? run?.agentId
        let text = sentText
        let reply: String? = out?["reply"]?.string ?? out?["report"]?.string ?? (run?.status != "running" ? run?.result : nil)
        let pending = call.running
        let working = pending && streaming && run?.status != "done" && run?.status != "error"
        let failed = call.failed || out?["ok"]?.bool == false
        let error = call.error ?? (out?["ok"]?.bool == false ? out?["error"]?.string : nil)
        let threadId = out?["threadId"]?.string ?? run?.threadId

        if call.state == "input-streaming" && text.isEmpty {
            HStack(spacing: 7) {
                Image(systemName: "message").font(.system(size: 14))
                ShimmerText(text: "Writing to \(name)")
            }
            .font(.system(size: 14.5))
            .foregroundStyle(.secondary)
            .frame(minHeight: 28)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                DisclosureRow {
                    Image(systemName: "message").font(.system(size: 14))
                    Text("Sent message to").layoutPriority(1)
                    who(name: name, color: color, shape: shape, working: working)
                    if working {
                        ShimmerText(text: run?.current ?? "Working").font(.system(size: 13)).lineLimit(1)
                    } else if failed && reply == nil {
                        Image(systemName: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(Color.danger)
                    }
                } content: {
                    MessageCard(direction: "To", kind: "agent", name: name, color: color, shape: shape, text: text, markdown: false) {
                        open(threadId: threadId, agentId: agentId)
                    }
                    if failed, let error { Text(error).font(.system(size: 13)).foregroundStyle(Color.danger) }
                    if out?["status"]?.string == "delivered", let note = out?["note"]?.string {
                        Text(note).font(.system(size: 13)).foregroundStyle(.tertiary)
                    }
                }
                if let reply, !failed {
                    DisclosureRow {
                        Image(systemName: "message").font(.system(size: 14))
                        Text("Received message from").layoutPriority(1)
                        who(name: name, color: color, shape: shape, working: false)
                    } content: {
                        MessageCard(direction: "From", kind: "agent", name: name, color: color, shape: shape, text: reply, markdown: true) {
                            open(threadId: threadId, agentId: agentId)
                        }
                    }
                }
            }
        }
    }

    private var targetName: String {
        if call.name == "study_helper" { return "Study AI" }
        let raw = call.input?["to"]?.string ?? call.input?["name"]?.string ?? call.input?["agent"]?.string ?? "agent"
        return raw.hasPrefix("@") ? String(raw.dropFirst()) : raw
    }

    private var sentText: String {
        call.input?["text"]?.string ?? call.input?["task"]?.string ?? call.input?["request"]?.string ?? call.input?["question"]?.string ?? ""
    }

    private func who(name: String, color: String, shape: String?, working: Bool) -> some View {
        HStack(spacing: 5) {
            AgentFace(shape: shape, color: color, size: 16, working: working, seed: name)
            Text(name).fontWeight(.medium).foregroundStyle(.primary.opacity(0.8)).lineLimit(1)
        }
    }

    private func open(threadId: String?, agentId: String?) {
        if let agentId, !agentId.isEmpty, model.agentId != agentId {
            shell.openAgent(id: agentId, threadId: threadId)
        } else if let threadId {
            shell.go(.chat(id: threadId, isNew: false, agentId: agentId))
        }
    }
}

/// In an agent's own thread: a message it got from Opal or another agent.
struct InboundMessage: View {
    let message: ChatMessage
    let from: AgentSender

    var body: some View {
        DisclosureRow {
            Image(systemName: "message").font(.system(size: 14))
            Text("Received message from")
            HStack(spacing: 5) {
                SenderFace(kind: from.kind, name: from.name, color: from.color, shape: from.shape, size: 16)
                Text(from.name).fontWeight(.medium).foregroundStyle(.primary.opacity(0.8)).lineLimit(1)
            }
        } content: {
            MessageCard(direction: "From", kind: from.kind, name: from.name, color: from.color, shape: from.shape, text: message.text, markdown: false, onOpen: nil)
        }
    }
}

/// Who a message went to (or came from), and the message.
struct MessageCard: View {
    let direction: String
    let kind: String?
    let name: String
    let color: String?
    let shape: String?
    let text: String
    let markdown: Bool
    var onOpen: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { onOpen?() } label: {
                HStack(spacing: 6) {
                    Text(direction).foregroundStyle(.secondary)
                    SenderFace(kind: kind, name: name, color: color, shape: shape, size: 18)
                    Text(name).fontWeight(.medium)
                    if onOpen != nil {
                        Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
                    }
                }
                .font(.system(size: 14))
                .foregroundStyle(.primary)
            }
            .buttonStyle(PressableStyle())
            .disabled(onOpen == nil)
            Group {
                if markdown {
                    MarkdownView(text: text, size: 15)
                } else {
                    Text(text).font(.system(size: 15)).lineSpacing(3).foregroundStyle(.primary.opacity(0.85))
                }
            }
            .lineLimit(10)
            .contentShape(.rect)
            .onTapGesture { onOpen?() }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: 620, alignment: .leading)
        .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
    }
}

// MARK: Approval

/// "Opal wants to run an action", with a preview that looks like the thing (an email like an
/// email, a message like a message), and Deny / Approve.
struct ApprovalCard: View {
    let call: ToolCall
    let model: ChatModel
    @Environment(\.accent) private var accent

    private struct Call { let slug: String; let args: [String: JSONValue] }

    private var calls: [Call] {
        let tools = call.input?["tools"]?.array ?? []
        if !tools.isEmpty {
            return tools.map { t in
                let args: [String: JSONValue]
                if case .object(let o)? = t["arguments"] ?? t["input"] { args = o } else { args = [:] }
                return Call(slug: t["tool_slug"]?.string ?? t["slug"]?.string ?? call.name, args: args)
            }
        }
        if case .object(let o)? = call.input { return [Call(slug: call.name, args: o)] }
        return [Call(slug: call.name, args: [:])]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "powerplug").foregroundStyle(.secondary)
                Text("Opal wants to run an action").fontWeight(.medium)
            }
            .font(.system(size: 15))
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(calls.enumerated()), id: \.offset) { _, c in preview(c) }
            }
            .padding(14)
            HStack(spacing: 8) {
                Spacer()
                Button("Deny") { decide(false) }
                    .font(.system(size: 15, weight: .medium))
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .background(Color.wash, in: Capsule())
                Button("Approve") { decide(true) }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(accent.fg)
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .background(accent.fill, in: Capsule())
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .background(Color.canvas, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.primary.opacity(0.1)) }
    }

    private func decide(_ approved: Bool) {
        guard let id = call.approvalId else { return }
        model.respondToApproval(id, approved: approved)
    }

    private func str(_ v: JSONValue?) -> String {
        switch v {
        case .string(let s)?: return s
        case .number(let n)?: return n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b)?: return b ? "true" : "false"
        case nil, .null?: return ""
        case let other?: return other.pretty.replacingOccurrences(of: "\n", with: " ")
        }
    }

    @ViewBuilder private func preview(_ c: Call) -> some View {
        let slug = c.slug.uppercased()
        let a = c.args
        VStack(alignment: .leading, spacing: 6) {
            if (slug.contains("MAIL")) && (a["subject"] != nil || a["body"] != nil || a["recipient_email"] != nil || a["to"] != nil) {
                Label(prettySlug(c.slug), systemImage: "envelope").font(.system(size: 13)).foregroundStyle(.secondary)
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
                    GridRow { Text("To").foregroundStyle(.tertiary); Text(str(a["recipient_email"] ?? a["to"] ?? a["recipients"])).lineLimit(1) }
                    if a["cc"] != nil { GridRow { Text("Cc").foregroundStyle(.tertiary); Text(str(a["cc"])).lineLimit(1) } }
                    GridRow { Text("Subject").foregroundStyle(.tertiary); Text(str(a["subject"])).fontWeight(.medium) }
                }
                .font(.system(size: 14))
                Divider()
                ScrollView { Text(str(a["body"] ?? a["message_body"])).font(.system(size: 14.5)).lineSpacing(3).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 200).fixedSize(horizontal: false, vertical: true)
            } else if ["SLACK", "DISCORD", "TELEGRAM", "WHATSAPP", "MESSAGE", "POST"].contains(where: slug.contains), a["text"] != nil || a["content"] != nil || a["message"] != nil {
                Label("\(prettySlug(c.slug))\(a["channel"].map { " in \(str($0))" } ?? "")", systemImage: "message").font(.system(size: 13)).foregroundStyle(.secondary)
                Text(str(a["text"] ?? a["content"] ?? a["message"])).font(.system(size: 14.5)).lineSpacing(3)
            } else if slug.contains("CALENDAR") || slug.contains("EVENT"), a["summary"] != nil || a["title"] != nil || a["start_datetime"] != nil || a["start"] != nil {
                Label(prettySlug(c.slug), systemImage: "calendar").font(.system(size: 13)).foregroundStyle(.secondary)
                Text(str(a["summary"] ?? a["title"]).isEmpty ? "Event" : str(a["summary"] ?? a["title"])).font(.system(size: 15, weight: .medium))
                Text([str(a["start_datetime"] ?? a["start"]), str(a["end_datetime"] ?? a["end"])].filter { !$0.isEmpty }.joined(separator: "  to  "))
                    .font(.system(size: 13.5)).foregroundStyle(.secondary)
            } else {
                Text(prettySlug(c.slug)).font(.system(size: 14, weight: .medium))
                let entries = a.filter { $0.value != .null && str($0.value) != "" }.sorted { $0.key < $1.key }
                if entries.isEmpty {
                    Text("No parameters").font(.system(size: 13)).foregroundStyle(.tertiary)
                } else {
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
                        ForEach(entries.prefix(12), id: \.key) { k, v in
                            GridRow {
                                Text(k.replacingOccurrences(of: "_", with: " ")).foregroundStyle(.tertiary)
                                Text(str(v)).lineLimit(4)
                            }
                        }
                    }
                    .font(.system(size: 13.5))
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.08)) }
    }
}
