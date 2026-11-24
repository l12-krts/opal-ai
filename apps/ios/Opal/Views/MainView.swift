import SwiftUI

enum Route: Hashable {
    case chat(id: String, isNew: Bool, agentId: String?)
    case code
    case agents
    case customization
    case settings
}

/// A page of Settings, Customization or Opal Code settings. Pushed on whatever is showing, so
/// "Manage memory" from a chat comes back to the chat.
enum SettingsPage: String, Hashable, CaseIterable, Identifiable {
    case general, study, handwriting, secrets
    case memory, skills, connectors
    case codeGeneral, codeMachines, codeProjects, codeSkills

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general, .codeGeneral: "General"
        case .study: "Study"
        case .handwriting: "Handwriting"
        case .secrets: "Secrets vault"
        case .memory: "Memory"
        case .skills, .codeSkills: "Skills"
        case .connectors: "Connectors"
        case .codeMachines: "Machines"
        case .codeProjects: "Projects"
        }
    }

    var systemImage: String {
        switch self {
        case .general, .codeGeneral: "gearshape"
        case .study: "book"
        case .handwriting: "signature"
        case .secrets: "key"
        case .memory: "brain"
        case .skills, .codeSkills: "wand.and.stars"
        case .connectors: "square.grid.2x2"
        case .codeMachines: "server.rack"
        case .codeProjects: "folder"
        }
    }

    static let settings: [SettingsPage] = [.general, .study, .handwriting, .secrets]
    static let customization: [SettingsPage] = [.memory, .skills, .connectors]
    static let code: [SettingsPage] = [.codeGeneral, .codeMachines, .codeProjects, .codeSkills]
}

/// Screens pushed on top of a route.
enum Pushed: Hashable {
    case codeThread(String)
    case newCodeThread
    case settings(SettingsPage)
}

/// Where the app is: the current route, what's pushed on it, whether the sidebar is out, the
/// chat list the sidebar shows, and the chats you've had open lately (kept alive, so a reply
/// keeps streaming while you look at something else).
@MainActor
@Observable
final class Shell {
    var route: Route
    var path: [Pushed] = []
    var sidebarOpen = false
    /// The composer's menu is open: the sidebar swipe stays out of its way.
    var drawerLocked = false
    private(set) var conversations: [Conversation] = []
    private(set) var loadingChats = true
    private(set) var agents: [Agent] = []
    private(set) var agentsLoaded = false

    @ObservationIgnored var session: SessionStore?
    @ObservationIgnored private var models: [String: ChatModel] = [:]
    @ObservationIgnored private var recent: [String] = []
    /// Set-up for a chat that hasn't been opened yet: study mode, a first message to send.
    @ObservationIgnored private var seeds: [String: (study: Bool, prompt: String?)] = [:]
    /// When the app went to the background.
    @ObservationIgnored private var awayAt: Date?

    init() {
        if let start = Demo.start {
            route = start.route
            path = start.path
            sidebarOpen = Demo.flag("-demoSidebar")
            return
        }
        route = .chat(id: ChatModel.newId(), isNew: true, agentId: nil)
        sidebarOpen = Demo.flag("-demoSidebar")
    }

    func go(_ route: Route) {
        self.route = route
        path = []
        withAnimation(Motion.drawer) { sidebarOpen = false }
    }

    /// Pushes a screen on what's showing now.
    func open(_ screen: Pushed) {
        withAnimation(Motion.drawer) { sidebarOpen = false }
        path.append(screen)
    }

    func newChat(study: Bool = false, prompt: String? = nil) {
        let id = ChatModel.newId()
        if study || prompt != nil { seeds[id] = (study, prompt) }
        go(.chat(id: id, isNew: true, agentId: nil))
    }

    /// An agent's one thread; asks the server for it when it isn't known yet.
    func openAgent(id: String, threadId: String?) {
        if let threadId, !threadId.isEmpty {
            go(.chat(id: threadId, isNew: false, agentId: id))
            return
        }
        guard let session else { return }
        Task {
            struct Res: Decodable { let threadId: String }
            if let thread = try? await session.api.send("/api/agents/\(id)/thread", as: Res.self).threadId {
                go(.chat(id: thread, isNew: false, agentId: id))
            }
        }
    }

    /// The model behind a chat screen, made once and kept for the last few chats.
    func chatModel(id: String, isNew: Bool, agentId: String?, session: SessionStore) -> ChatModel {
        if let m = models[id] {
            recent.removeAll { $0 == id }
            recent.append(id)
            return m
        }
        let m = ChatModel(id: id, isNew: isNew, session: session, agentId: agentId)
        if let seed = seeds.removeValue(forKey: id) {
            m.studyMode = seed.study
            m.queuedPrompt = seed.prompt
        }
        if let agentId { m.agent = agents.first { $0.id == agentId } }
        models[id] = m
        recent.append(id)
        // Keep six; a chat that's still answering is never dropped.
        for old in recent.dropLast() where recent.count > 6 {
            if models[old]?.busy == true { continue }
            models[old] = nil
            recent.removeAll { $0 == old }
        }
        return m
    }

    func setSidebar(_ open: Bool) {
        if open { dismissKeyboard() }
        withAnimation(Motion.drawer) { sidebarOpen = open }
    }

    /// The chat list as it was last time first (kept on the phone), then the server's.
    func loadChats(_ session: SessionStore) async {
        struct Res: Decodable { let conversations: [Conversation] }
        let path = "/api/conversations"
        if conversations.isEmpty, let kept = session.api.cached(path, as: Res.self)?.conversations {
            conversations = kept
            loadingChats = false
        }
        defer { loadingChats = false }
        do {
            let list = try await session.api.send(path, as: Res.self, cache: true).conversations
            withAnimation(Motion.morph) { conversations = list }
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {}
    }

    func loadAgents(_ session: SessionStore) async {
        struct Res: Decodable { let agents: [Agent] }
        let path = "/api/agents"
        if !agentsLoaded, let kept = session.api.cached(path, as: Res.self)?.agents {
            agents = kept.filter { $0.ephemeral != true }
            agentsLoaded = true
        }
        defer { agentsLoaded = true }
        if let list = try? await session.api.send(path, as: Res.self, cache: true).agents {
            withAnimation(Motion.morph) { agents = list.filter { $0.ephemeral != true } }
            for m in models.values { if let id = m.agentId { m.agent = agents.first { $0.id == id } ?? m.agent } }
        }
    }

    /// The app went to the background, or came back from it. Back: chats whose reply was cut off
    /// while the phone slept catch up with the server (which kept going), and the lists reload.
    func appPhase(active: Bool, _ session: SessionStore) {
        guard active else {
            awayAt = .now
            for m in models.values { m.appWentAway() }
            return
        }
        guard awayAt != nil else { return }
        awayAt = nil
        for m in models.values { m.appCameBack() }
        Task {
            async let chats: Void = loadChats(session)
            async let agents: Void = loadAgents(session)
            _ = await (chats, agents)
        }
    }

    /// The connection is back: catch up wherever a reply was cut off.
    func connectionCameBack(_ session: SessionStore) {
        for m in models.values { m.connectionCameBack() }
        Task {
            async let chats: Void = loadChats(session)
            async let agents: Void = loadAgents(session)
            _ = await (chats, agents)
        }
    }

    func upsert(_ agent: Agent) {
        withAnimation(Motion.morph) {
            if let i = agents.firstIndex(where: { $0.id == agent.id }) { agents[i] = agent } else { agents.insert(agent, at: 0) }
        }
        for m in models.values where m.agentId == agent.id { m.agent = agent }
    }

    func removeAgent(_ id: String) {
        withAnimation(Motion.morph) { agents.removeAll { $0.id == id } }
        if case .chat(_, _, let agentId) = route, agentId == id { go(.agents) }
    }

    func rename(_ c: Conversation, to title: String, _ session: SessionStore) async {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let i = conversations.firstIndex(of: c) else { return }
        conversations[i].title = t
        models[c.id]?.title = t
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "PATCH", json: ["title": t])
    }

    func setPinned(_ c: Conversation, _ pinned: Bool, _ session: SessionStore) async {
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "PATCH", json: ["pinned": pinned])
        await loadChats(session)
    }

    func delete(_ c: Conversation, _ session: SessionStore) async {
        withAnimation(Motion.morph) { conversations.removeAll { $0.id == c.id } }
        models[c.id] = nil
        recent.removeAll { $0 == c.id }
        if case .chat(let id, _, _) = route, id == c.id { newChat() }
        _ = try? await session.api.sendRaw("/api/conversations/\(c.id)", method: "DELETE")
    }
}

/// The signed-in app. On a phone the sidebar sits underneath and the main screen slides aside to
/// reveal it (drag from anywhere, or tap the sidebar button). On iPad the sidebar stays put.
struct MainView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var shell = Shell()
    @State private var code = CodeStore()

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
                GeometryReader { geo in
                    Drawer(width: geo.size.width) { w in
                        SidebarView(width: w)
                    } content: {
                        content
                    }
                }
            }
        }
        .environment(shell)
        .environment(code)
        .onAppear { shell.session = session }
        .task {
            shell.session = session
            async let chats: Void = shell.loadChats(session)
            async let user: Void = session.loadUser()
            async let agents: Void = shell.loadAgents(session)
            _ = await (chats, user, agents)
        }
        .task { await code.run(session) }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                shell.appPhase(active: false, session)
            case .active:
                shell.appPhase(active: true, session)
                Task { await code.load() }
            default:
                break
            }
        }
        .onChange(of: Connectivity.shared.reconnects) {
            shell.connectionCameBack(session)
            Task { await code.load() }
        }
    }

    private var content: some View {
        NavigationStack(path: $shell.path) {
            root
                .navigationDestination(for: Pushed.self) { p in
                    switch p {
                    case .codeThread(let id): CodeThreadView(threadId: id)
                    case .newCodeThread: NewCodeThreadView()
                    case .settings(let page): SettingsPageView(page: page)
                    }
                }
        }
        // Under the header, while there's no connection.
        .overlay(alignment: .top) {
            OfflineBanner()
                .padding(.top, 58)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder private var root: some View {
        switch shell.route {
        case .chat(let id, let isNew, let agentId):
            ChatScreen(model: shell.chatModel(id: id, isNew: isNew, agentId: agentId, session: session), onActivity: {
                Task { await shell.loadChats(session) }
            })
            .id(id)
        case .code:
            CodeHomeView()
        case .agents:
            AgentsView()
        case .customization:
            SettingsHome(title: "Customization", pages: SettingsPage.customization)
        case .settings:
            SettingsHome(title: "Settings", pages: SettingsPage.settings)
        }
    }
}

// MARK: Drawer

/// The phone's sidebar: it sits underneath and the screen slides aside to show it, following the
/// finger. The axis is decided once per drag, so a vertical scroll never turns into a swipe. Let go
/// and a spring carries on at the finger's speed: a flick opens or closes it whatever the distance,
/// a slow drag settles on the nearer side.
struct Drawer<Sidebar: View, Content: View>: View {
    let width: CGFloat
    @ViewBuilder var sidebar: (CGFloat) -> Sidebar
    @ViewBuilder var content: Content

    @Environment(Shell.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGFloat = 0
    @State private var axis: Axis?
    @GestureState private var dragging = false

    private var sidebarWidth: CGFloat { min(width * 0.84, 340) }

    var body: some View {
        let w = sidebarWidth
        let progress = openProgress(w)
        let radius = progress > 0.001 ? Screen.concentric(inset: 0, minimum: 12) : 0
        ZStack(alignment: .leading) {
            sidebar(w)
                .frame(width: w)
                // Parallax: the sidebar moves a third as far as the screen, so it feels underneath.
                .offset(x: reduceMotion ? 0 : (min(progress, 1) - 1) * w * 0.3)
                .overlay { Color.black.opacity(0.2 * (1 - min(progress, 1))).ignoresSafeArea().allowsHitTesting(false) }
                .accessibilityHidden(!shell.sidebarOpen)

            content
                .background(Color.canvas.ignoresSafeArea())
                .mask { RoundedRectangle(cornerRadius: radius, style: .continuous).ignoresSafeArea() }
                .overlay {
                    // Dims the screen as it moves aside; a tap on it closes the sidebar.
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(Color.black.opacity(0.16 * min(progress, 1)))
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { shell.setSidebar(false) }
                        .allowsHitTesting(shell.sidebarOpen)
                }
                .background {
                    // A soft shadow cast by the screen's own rounded shape, so it follows the
                    // corners. Only while the screen is moved aside.
                    if progress > 0.001 {
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(Color.canvas)
                            .shadow(color: .black.opacity(0.16 * min(progress, 1)), radius: 16, x: -3, y: 0)
                            .ignoresSafeArea()
                    }
                }
                .offset(x: progress * w)
                .accessibilityHidden(shell.sidebarOpen)
        }
        .background(Color.sidebar.ignoresSafeArea())
        .simultaneousGesture(swipe(w), including: shell.path.isEmpty && !shell.drawerLocked ? .all : .subviews)
        .sensoryFeedback(.impact(weight: .light, intensity: 0.55), trigger: shell.sidebarOpen)
        .onChange(of: dragging) { _, now in
            // The system took the touch (a call, Control Center) without ending the drag.
            if !now && drag != 0 { settle(open: shell.sidebarOpen, velocity: 0, width: w) }
        }
    }

    private func openProgress(_ w: CGFloat) -> CGFloat {
        let raw = (shell.sidebarOpen ? 1 : 0) + drag / w
        // Past either end the screen keeps following, with more and more resistance.
        if raw > 1 { return 1 + (1 - 1 / ((raw - 1) * 0.55 + 1)) * 0.05 }
        return max(raw, 0)
    }

    private func swipe(_ w: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($dragging) { _, state, _ in state = true }
            .onChanged { v in
                if axis == nil {
                    axis = abs(v.translation.width) > abs(v.translation.height) * 1.2 ? .horizontal : .vertical
                    if axis == .horizontal { dismissKeyboard() }
                }
                guard axis == .horizontal else { return }
                // Closed, only a rightward pull does anything; open, only a leftward one.
                drag = shell.sidebarOpen ? min(v.translation.width, w * 0.25) : max(v.translation.width, 0)
            }
            .onEnded { v in
                defer { axis = nil }
                guard axis == .horizontal else { return }
                let progress = min(openProgress(w), 1)
                let speed = v.velocity.width
                let open = abs(speed) > 500 ? speed > 0 : progress > 0.5
                settle(open: open, velocity: speed, width: w)
            }
    }

    private func settle(open: Bool, velocity: CGFloat, width w: CGFloat) {
        let progress = min(openProgress(w), 1)
        let remaining = ((open ? 1 : 0) - progress) * w
        // The spring starts at the finger's speed, as a share of the distance left per second.
        let relative = abs(remaining) > 1 ? max(0, min(velocity / remaining, 24)) : 0
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .interpolatingSpring(duration: 0.42, bounce: 0, initialVelocity: relative)) {
            shell.sidebarOpen = open
            drag = 0
        }
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
            center.frame(maxWidth: 230)
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

/// A title in a glass capsule, for the middle of a `ScreenHeader`.
struct HeaderTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 18)
            .frame(height: 40)
            .opalGlass(in: Capsule())
    }
}
