import SwiftUI

enum Route: Hashable {
    case chat(id: String, isNew: Bool, agentId: String?)
    case agents
    case settings
}

struct MainView: View {
    @Environment(SessionStore.self) private var session
    @State private var conversations: [Conversation] = []
    @State private var selection: Route? = .chat(id: ChatModel.newId(), isNew: true, agentId: nil)
    @State private var loading = true

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    NavigationLink(value: Route.chat(id: ChatModel.newId(), isNew: true, agentId: nil)) {
                        Label("New chat", systemImage: "square.and.pencil")
                    }
                    NavigationLink(value: Route.agents) { Label("Agents", systemImage: "person.2") }
                }
                Section("Recent") {
                    if loading && conversations.isEmpty {
                        ForEach(0..<4, id: \.self) { _ in Text("Loading chat").redacted(reason: .placeholder) }
                    }
                    ForEach(conversations) { c in
                        NavigationLink(value: Route.chat(id: c.id, isNew: false, agentId: c.agentId)) {
                            Text(c.title).lineLimit(1)
                        }
                    }
                }
            }
            .navigationTitle("Opal")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: Route.settings) { Image(systemName: "gearshape") }
                }
            }
            .refreshable { await load() }
        } detail: {
            switch selection {
            case .chat(let id, let isNew, let agentId):
                ChatScreen(model: ChatModel(id: id, isNew: isNew, session: session, agentId: agentId), onActivity: { Task { await load() } })
                    .id(id)
            case .agents:
                AgentsView(onOpen: { agent in
                    Task {
                        // Each agent has one thread; the server creates it on first open.
                        struct Res: Decodable { let threadId: String }
                        // `??` takes an autoclosure, which can't `await`, so fetch in a separate step.
                        var thread = agent.threadId
                        if thread == nil {
                            thread = try? await session.api.send("/api/agents/\(agent.id)/thread", as: Res.self).threadId
                        }
                        if let thread { selection = .chat(id: thread, isNew: false, agentId: agent.id) }
                    }
                })
            case .settings:
                SettingsView()
            case nil:
                ContentUnavailableView("Pick a chat", systemImage: "bubble.left")
            }
        }
        .task {
            await load()
            await session.loadUser()
        }
    }

    private func load() async {
        struct Res: Decodable { let conversations: [Conversation] }
        defer { loading = false }
        do {
            conversations = try await session.api.send("/api/conversations", as: Res.self).conversations
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {}
    }
}

extension ChatModel {
    static func newId() -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        return String((0..<21).map { _ in alphabet.randomElement()! })
    }
}
