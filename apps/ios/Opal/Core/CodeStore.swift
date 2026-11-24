import Foundation
import Observation
import SwiftUI

// Opal Code: coding agents (Claude Code, Codex) running on your own machines. Same API as the web
// (apps/web/src/app/api/code, types in apps/web/src/lib/code-types.ts).

struct CodeMachine: Decodable, Identifiable, Hashable {
    struct AgentInfo: Decodable, Hashable {
        let id: String
        let version: String?
        let ok: Bool
        let note: String?
        let signedIn: Bool?
    }
    let id: String
    let name: String
    let os: String
    let hostname: String
    let online: Bool
    let agents: [AgentInfo]
    /// Where new projects go on this machine.
    var projectsRoot: String?
    var lastSeenAt: Date?

    func agent(_ id: String) -> AgentInfo? { agents.first { $0.id == id } }
}

struct CodeProject: Decodable, Identifiable, Hashable {
    let id: String
    let machineId: String
    let name: String
    let path: String
    let isGit: Bool
}

struct CodeThread: Decodable, Identifiable, Hashable {
    let id: String
    var title: String
    let agent: String
    let model: String?
    var mode: String
    var status: String
    let machineId: String
    let projectId: String?
    let cwd: String
    let branch: String?
    let worktree: Bool
    let prUrl: String?
    var pinnedAt: Date?
    let snoozedUntil: Date?
    var settledAt: Date?
    var lastReadAt: Date?
    let lastActivityAt: Date
    let preview: String?

    var unread: Bool { lastReadAt.map { lastActivityAt > $0 } ?? true }

    enum Section: Int, CaseIterable { case needs, working, pinned, done, snoozed, settled
        var title: String {
            switch self {
            case .needs: "Needs you"
            case .working: "Working"
            case .pinned: "Pinned"
            case .done: "Done"
            case .snoozed: "Snoozed"
            case .settled: "Settled"
            }
        }
    }

    /// Which inbox section the thread belongs in (same rules as the web).
    var section: Section {
        if settledAt != nil { return .settled }
        if let s = snoozedUntil, s > .now { return .snoozed }
        if pinnedAt != nil { return .pinned }
        if status == "waiting" || status == "error" { return .needs }
        if status == "working" { return .working }
        return .done
    }
}

/// One entry in a thread: a message, a command, an edit, an approval… The shape depends on `kind`,
/// so the payload stays loosely typed.
struct CodeItem: Decodable, Identifiable, Hashable {
    let id: String
    let seq: Int
    let kind: String
    let data: JSONValue

    init(from decoder: any Decoder) throws {
        data = try JSONValue(from: decoder)
        id = data["id"]?.string ?? UUID().uuidString
        seq = data["seq"]?.int ?? 0
        kind = data["kind"]?.string ?? "notice"
    }

    subscript(key: String) -> JSONValue? { data[key] }
    var text: String { data["text"]?.string ?? "" }
    var status: String { data["status"]?.string ?? "" }
}

enum CodeAgents {
    struct Option: Identifiable, Hashable, Sendable { let id: String; let label: String }
    struct Spec: Identifiable, Sendable { let id: String; let label: String; let models: [Option] }
    struct Mode: Identifiable, Sendable { let id: String; let label: String; let hint: String; let icon: String }

    static let all: [Spec] = [
        Spec(id: "claude", label: "Claude Code", models: [
            Option(id: "default", label: "Default"), Option(id: "opus", label: "Opus"),
            Option(id: "sonnet", label: "Sonnet"), Option(id: "haiku", label: "Haiku"),
        ]),
        Spec(id: "codex", label: "Codex", models: [
            Option(id: "default", label: "Default"), Option(id: "gpt-5.5", label: "GPT-5.5"),
            Option(id: "gpt-5.5-codex", label: "GPT-5.5 Codex"), Option(id: "gpt-5.4-mini", label: "GPT-5.4 mini"),
        ]),
    ]
    static func label(_ id: String) -> String { all.first { $0.id == id }?.label ?? id }

    static let modes: [Mode] = [
        Mode(id: "auto", label: "Auto", hint: "Edits files, asks before risky commands", icon: "wand.and.stars"),
        Mode(id: "ask", label: "Ask first", hint: "Asks before every change", icon: "hand.raised"),
        Mode(id: "full", label: "Full access", hint: "Runs anything without asking", icon: "bolt"),
    ]
    static func modeLabel(_ id: String) -> String { modes.first { $0.id == id }?.label ?? id }
}

@MainActor
@Observable
final class CodeStore {
    private(set) var machines: [CodeMachine] = []
    private(set) var projects: [CodeProject] = []
    private(set) var threads: [CodeThread] = []
    private(set) var items: [String: [CodeItem]] = [:]
    private(set) var loaded = false
    private(set) var error: String?
    private var session: SessionStore?

    var needsYouCount: Int { threads.filter { $0.section == .needs }.count }

    func project(_ id: String?) -> CodeProject? { id.flatMap { pid in projects.first { $0.id == pid } } }
    func machine(_ id: String) -> CodeMachine? { machines.first { $0.id == id } }
    func thread(_ id: String) -> CodeThread? { threads.first { $0.id == id } }

    /// Loads everything, then follows live updates until the task is cancelled, reconnecting
    /// with a growing pause when the stream drops.
    func run(_ session: SessionStore) async {
        self.session = session
        var pause: UInt64 = 1
        while !Task.isCancelled {
            await load()
            do {
                try await follow()
                pause = 1
            } catch is CancellationError {
                return
            } catch let e as APIError where e.status == 401 {
                session.handleUnauthorized(e)
                return
            } catch {}
            try? await Task.sleep(nanoseconds: pause * 1_000_000_000)
            pause = min(pause * 2, 30)
        }
    }

    func load() async {
        guard let session else { return }
        struct State: Decodable { let machines: [CodeMachine]; let projects: [CodeProject]; let threads: [CodeThread] }
        do {
            let s = try await session.api.send("/api/code/state", as: State.self)
            machines = s.machines
            projects = s.projects
            withAnimation(Motion.morph) { threads = s.threads }
            error = nil
        } catch {
            if !loaded { self.error = error.localizedDescription }
        }
        loaded = true
    }

    private func follow() async throws {
        guard let session else { return }
        var req = try session.api.request("/api/code/events")
        req.timeoutInterval = 86_400
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError(status: http.statusCode, code: http.statusCode == 401 ? "unauthorized" : "error", message: "Live updates failed")
        }
        for try await line in bytes.lines {
            guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8) else { continue }
            apply(data)
        }
    }

    private func apply(_ data: Data) {
        struct Head: Decodable { let type: String }
        guard let head = try? JSONDecoder().decode(Head.self, from: data) else { return }
        let decoder = JSONDecoder.opal
        switch head.type {
        case "thread":
            struct E: Decodable { let thread: CodeThread }
            guard let t = try? decoder.decode(E.self, from: data).thread else { return }
            withAnimation(Motion.morph) {
                if let i = threads.firstIndex(where: { $0.id == t.id }) { threads[i] = t } else { threads.insert(t, at: 0) }
                threads.sort { $0.lastActivityAt > $1.lastActivityAt }
            }
        case "thread-deleted":
            struct E: Decodable { let threadId: String }
            guard let id = try? decoder.decode(E.self, from: data).threadId else { return }
            withAnimation(Motion.morph) { threads.removeAll { $0.id == id } }
            items[id] = nil
        case "item":
            struct E: Decodable { let threadId: String; let item: CodeItem }
            guard let e = try? decoder.decode(E.self, from: data), items[e.threadId] != nil else { return }
            upsert(e.item, in: e.threadId)
        case "machine":
            struct E: Decodable { let machine: CodeMachine }
            guard let m = try? decoder.decode(E.self, from: data).machine else { return }
            if let i = machines.firstIndex(where: { $0.id == m.id }) { machines[i] = m } else { machines.append(m) }
        default:
            break
        }
    }

    private func upsert(_ item: CodeItem, in threadId: String) {
        var list = items[threadId] ?? []
        if let i = list.firstIndex(where: { $0.id == item.id }) {
            list[i] = item
            items[threadId] = list
        } else {
            list.append(item)
            list.sort { $0.seq < $1.seq }
            withAnimation(Motion.morph) { items[threadId] = list }
        }
    }

    // MARK: Actions

    func open(_ threadId: String) async {
        guard let session else { return }
        struct Res: Decodable { let thread: CodeThread; let items: [CodeItem] }
        do {
            let res = try await session.api.send("/api/code/threads/\(threadId)", as: Res.self)
            items[threadId] = res.items
            replace(res.thread)
        } catch {}
        _ = try? await session.api.sendRaw("/api/code/threads/\(threadId)", method: "PATCH", json: ["read": true])
    }

    func close(_ threadId: String) { items[threadId] = nil }

    func send(_ text: String, to threadId: String) async throws {
        guard let session else { return }
        struct Body: Encodable { let text: String }
        _ = try await session.api.sendRaw("/api/code/threads/\(threadId)/messages", json: Body(text: text))
    }

    func interrupt(_ threadId: String) async {
        _ = try? await session?.api.sendRaw("/api/code/threads/\(threadId)/interrupt")
    }

    func respond(_ threadId: String, requestId: String, decision: String) async {
        struct Body: Encodable { let requestId: String; let decision: String }
        _ = try? await session?.api.sendRaw("/api/code/threads/\(threadId)/approvals", json: Body(requestId: requestId, decision: decision))
    }

    func patch(_ threadId: String, _ body: [String: JSONValue]) async {
        struct Res: Decodable { let thread: CodeThread? }
        guard let session else { return }
        if let t = try? await session.api.send("/api/code/threads/\(threadId)", method: "PATCH", json: JSONValue.object(body), as: Res.self).thread {
            replace(t)
        }
    }

    func delete(_ threadId: String) async {
        withAnimation(Motion.morph) { threads.removeAll { $0.id == threadId } }
        _ = try? await session?.api.sendRaw("/api/code/threads/\(threadId)", method: "DELETE")
    }

    /// Starts one thread per agent. Returns the new thread ids.
    func start(projectId: String?, machineId: String?, agents: [(agent: String, model: String?)], mode: String, worktree: Bool, text: String) async throws -> [String] {
        guard let session else { return [] }
        struct Body: Encodable {
            struct A: Encodable { let agent: String; let model: String? }
            let projectId: String?
            let machineId: String?
            let agents: [A]
            let mode: String
            let worktree: Bool
            let text: String
        }
        struct Res: Decodable { let threads: [String] }
        let body = Body(projectId: projectId, machineId: machineId, agents: agents.map { Body.A(agent: $0.agent, model: $0.model == "default" ? nil : $0.model) }, mode: mode, worktree: worktree, text: text)
        let ids = try await session.api.send("/api/code/threads", method: "POST", json: body, as: Res.self).threads
        await load()
        return ids
    }

    private func replace(_ t: CodeThread) {
        if let i = threads.firstIndex(where: { $0.id == t.id }) { threads[i] = t } else { threads.insert(t, at: 0) }
    }
}
