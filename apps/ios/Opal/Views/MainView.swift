import SwiftUI

enum Route: Hashable {
    case chat(id: String, isNew: Bool, agentId: String?)
    case code
    case agents
    case settings
}

/// Screens pushed on top of a route.
enum Pushed: Hashable {
    case codeThread(String)
    case newCodeThread
}

/// Where the app is: the current route, what's pushed on it, whether the sidebar is out, and the
/// chat list the sidebar shows.
@MainActor
@Observable
final class Shell {
    var route: Route = .chat(id: ChatModel.newId(), isNew: true, agentId: nil)
    var path: [Pushed] = []
    var sidebarOpen = false
    private(set) var conversations: [Conversation] = []
    private(set) var loadingChats = true

    func go(_ route: Route) {
        self.route = route
        path = []
        withAnimation(Motion.drawer) { sidebarOpen = false }
    }

    func newChat() { go(.chat(id: ChatModel.newId(), isNew: true, agentId: nil)) }

    func setSidebar(_ open: Bool) {
        if open { dismissKeyboard() }
        withAnimation(Motion.drawer) { sidebarOpen = open }
    }

    func loadChats(_ session: SessionStore) async {
        struct Res: Decodable { let conversations: [Conversation] }
        defer { loadingChats = false }
        do {
            let list = try await session.api.send("/api/conversations", as: Res.self).conversations
            withAnimation(Motion.morph) { conversations = list }
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {}
    }

    func rename(_ c: Conversation, to title: String, _ session: SessionStore) async {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let i = conversations.firstIndex(of: c) else { return }
        conversations[i].title = t
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "PATCH", json: ["title": t])
    }

    func setPinned(_ c: Conversation, _ pinned: Bool, _ session: SessionStore) async {
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "PATCH", json: ["pinned": pinned])
        await loadChats(session)
    }

    func delete(_ c: Conversation, _ session: SessionStore) async {
        withAnimation(Motion.morph) { conversations.removeAll { $0.id == c.id } }
        if case .chat(let id, _, _) = route, id == c.id { newChat() }
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "DELETE")
    }
}

/// The signed-in app. On a phone the sidebar sits underneath and the main screen slides aside to
/// reveal it (drag from anywhere, or tap the sidebar button). On iPad the sidebar stays put.
struct MainView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shell = Shell()
    @State private var code = CodeStore()
    /// Live drag distance while the user swipes the main screen.
    @State private var drag: CGFloat = 0
    @State private var dragAxis: Axis?

    var body: some View {
        Group {
            if hSize == .regular {
                HStack(spacing: 0) {
                    SidebarView(width: 320)
                        .frame(width: 320)
                    Divider().ignoresSafeArea()
                    content
                }
            } else {
                GeometryReader { geo in phone(width: geo.size.width) }
            }
        }
        .environment(shell)
        .environment(code)
        .task {
            await shell.loadChats(session)
            await session.loadUser()
        }
        .task { await code.run(session) }
    }

    private var content: some View {
        NavigationStack(path: $shell.path) {
            root
                .navigationDestination(for: Pushed.self) { p in
                    switch p {
                    case .codeThread(let id): CodeThreadView(threadId: id)
                    case .newCodeThread: NewCodeThreadView()
                    }
                }
        }
    }

    @ViewBuilder private var root: some View {
        switch shell.route {
        case .chat(let id, let isNew, let agentId):
            ChatScreen(model: ChatModel(id: id, isNew: isNew, session: session, agentId: agentId), onActivity: { Task { await shell.loadChats(session) } })
                .id(id)
        case .code:
            CodeHomeView()
        case .agents:
            AgentsView(onOpen: open(agent:))
        case .settings:
            SettingsView()
        }
    }

    private func open(agent: Agent) {
        Task {
            // Each agent has one thread; the server creates it on first open.
            struct Res: Decodable { let threadId: String }
            // `??` takes an autoclosure, which can't `await`, so fetch in a separate step.
            var thread = agent.threadId
            if thread == nil {
                thread = try? await session.api.send("/api/agents/\(agent.id)/thread", as: Res.self).threadId
            }
            if let thread { shell.go(.chat(id: thread, isNew: false, agentId: agent.id)) }
        }
    }

    // MARK: Phone layout

    private func phone(width: CGFloat) -> some View {
        let sidebarWidth = min(width * 0.82, 340)
        let progress = openProgress(sidebarWidth)
        return ZStack(alignment: .leading) {
            SidebarView(width: sidebarWidth)
                .frame(width: sidebarWidth)
                .offset(x: reduceMotion ? 0 : (progress - 1) * 36)
                .opacity(0.35 + 0.65 * progress)

            content
                .background(Color.canvas.ignoresSafeArea())
                .mask { RoundedRectangle(cornerRadius: 34 * progress, style: .continuous).ignoresSafeArea() }
                .overlay {
                    // Dims the main screen as it moves back; a tap anywhere on it closes the sidebar.
                    Color.black.opacity(0.18 * progress)
                        .mask { RoundedRectangle(cornerRadius: 34 * progress, style: .continuous).ignoresSafeArea() }
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { shell.setSidebar(false) }
                        .allowsHitTesting(shell.sidebarOpen)
                }
                .scaleEffect(reduceMotion ? 1 : 1 - 0.04 * progress, anchor: .leading)
                .shadow(color: .black.opacity(0.16 * progress), radius: 24, x: -4)
                .offset(x: progress * sidebarWidth)
                .accessibilityHidden(shell.sidebarOpen)
        }
        .background(Color.sidebar.ignoresSafeArea())
        .simultaneousGesture(swipe(sidebarWidth), including: shell.path.isEmpty ? .all : .subviews)
        .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: shell.sidebarOpen)
    }

    private func openProgress(_ w: CGFloat) -> CGFloat {
        let base: CGFloat = shell.sidebarOpen ? 1 : 0
        let raw = base + drag / w
        // Past either end the screen keeps following, but with more and more resistance.
        if raw > 1 { return 1 + (1 - 1 / ((raw - 1) * 0.55 + 1)) * 0.06 }
        if raw < 0 { return 0 }
        return raw
    }

    private func swipe(_ w: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .global)
            .onChanged { v in
                if dragAxis == nil {
                    // Decide once per drag, so a vertical scroll never turns into a sidebar swipe.
                    dragAxis = abs(v.translation.width) > abs(v.translation.height) * 1.3 ? .horizontal : .vertical
                    if dragAxis == .horizontal { dismissKeyboard() }
                }
                guard dragAxis == .horizontal else { return }
                drag = v.translation.width
            }
            .onEnded { v in
                defer { dragAxis = nil }
                guard dragAxis == .horizontal else { return }
                // A quick flick counts as much as a long drag.
                let projected = (shell.sidebarOpen ? 1 : 0) + v.predictedEndTranslation.width / w
                let open = projected > 0.5
                withAnimation(Motion.drawer) {
                    shell.sidebarOpen = open
                    drag = 0
                }
            }
    }
}

extension ChatModel {
    nonisolated static func newId() -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        return String((0..<21).map { _ in alphabet.randomElement()! })
    }
}

/// The bar across the top of each main screen: sidebar button, a title in the middle, and one
/// action on the right. Content scrolls underneath.
struct ScreenHeader<Center: View, Trailing: View>: View {
    @Environment(Shell.self) private var shell
    @Environment(\.horizontalSizeClass) private var hSize
    @ViewBuilder var center: Center
    @ViewBuilder var trailing: Trailing

    var body: some View {
        ZStack {
            center.frame(maxWidth: 220)
            HStack {
                if hSize != .regular {
                    GlassIconButton(accessibility: "Open sidebar", action: { shell.setSidebar(!shell.sidebarOpen) }) {
                        SidebarGlyph()
                    }
                }
                Spacer()
                trailing
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(@ViewBuilder center: () -> Center) {
        self.center = center()
        self.trailing = EmptyView()
    }
}
