import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A message on its way from the composer into the chat. The composer keeps `field` current; on
/// send the chat records where the text was, and the new bubble starts there and flies into place
/// (the web's send animation).
@MainActor
enum Flight {
    static var field: CGRect = .zero
    /// The whole composer on screen (taps there don't put the keyboard away).
    static var composer: CGRect = .zero
    private static var pending: (text: String, from: CGRect, at: Date)?

    static func launch(_ text: String) {
        pending = field.width > 0 ? (text, field, .now) : nil
    }

    /// Whether a bubble showing `text` should fly in (it was sent a moment ago).
    static func expects(_ text: String) -> Bool {
        guard let p = pending else { return false }
        return p.text == text.trimmingCharacters(in: .whitespacesAndNewlines) && Date.now.timeIntervalSince(p.at) < 1.2
    }

    /// Where the flight starts, once; nil when there's no flight for `text`.
    static func take(_ text: String) -> CGRect? {
        guard expects(text), let p = pending else { return nil }
        pending = nil
        return p.from
    }
}

struct ChatScreen: View {
    let model: ChatModel
    var onActivity: () -> Void
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = ""
    @FocusState private var focused: Bool
    @State private var menuOpen = false
    @State private var menuPage: MenuPage = .main
    @State private var pickingPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pickingFiles = false
    @State private var greeting = Greeting.now(name: nil)
    @State private var welcomeShown = false
    /// The scroll view's visible height, without the keyboard (its largest so far).
    @State private var viewport: CGFloat = 0
    @State private var endY: CGFloat = 0
    @State private var endInView = true
    /// Where the end of the thread is on screen, updated every scroll frame. A plain object, so
    /// writing it doesn't redraw the chat.
    @State private var end = ScrollMark()
    /// The thread's scroll proxy, for the composer (which sits outside the scroll view).
    @State private var scroller: ScrollViewProxy?
    /// The message sent from this screen: it's scrolled to the top and the reply grows under it.
    @State private var pinned: String?
    @State private var pinnedTop: CGFloat?
    @State private var showComputer = false
    @State private var showAgent = false
    @State private var skills: [SlashSkill] = []

    private enum MenuPage { case main, models, camera }

    private static let landing = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.42)

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if showsWelcome {
                    welcome
                } else {
                    thread
                }
            }
            .scrollDismissesKeyboard(.interactively)
            // The greeting (or "Message Scout") stays put: there's nothing to scroll to yet.
            .scrollDisabled(showsWelcome)
            .startsAtBottom()
            .onGeometryChange(for: CGFloat.self) { g in
                g.size.height - g.safeAreaInsets.top - g.safeAreaInsets.bottom
            } action: { h in
                viewport = max(viewport, h)
            }
            .overlay(alignment: .bottom) { jumpButton(proxy) }
            .onAppear {
                scroller = proxy
                if model.loaded { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: model.loaded) { _, loaded in
                if loaded { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: pinned) { _, key in
                guard let key else { return }
                withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Self.landing) { proxy.scrollTo(key, anchor: .top) }
            }
        }
        .overlay { MenuScrim(open: Binding(get: { menuOpen }, set: { if !$0 { closeMenu() } })) }
        .topBar { header }
        .bottomBar { composerStack }
        .composerMenu(open: menuOpen, expanded: menuPage == .camera) { plusMenu }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            if let q = model.queuedPrompt {
                model.queuedPrompt = nil
                draft = q
                send()
            }
        }
        .task { await loadSkills() }
        .onChange(of: shell.agents, initial: true) { _, agents in
            // Agents can arrive after the chat opens; the header and welcome need its face.
            if let id = model.agentId, let agent = agents.first(where: { $0.id == id }), agent != model.agent { model.agent = agent }
        }
        .onAppear { greeting = Greeting.now(name: session.userName) }
        .onChange(of: session.userName) { _, name in greeting = Greeting.now(name: name) }
        .onChange(of: model.busy) { _, busy in if !busy { onActivity() } }
        .onChange(of: menuOpen) { _, open in
            shell.drawerLocked = open
            if !open { menuPage = .main }
        }
        .onDisappear { shell.drawerLocked = false }
        .photosPicker(isPresented: $pickingPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { addFiles(urls) }
        }
        .sheet(isPresented: $showComputer) {
            ComputerSheet(frames: model.sandboxes, agentId: model.agentId)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showAgent) {
            if let agent = model.agent {
                AgentDetailsSheet(agent: agent, model: model)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    private var showsWelcome: Bool { model.messages.isEmpty && !model.busy && model.loaded }

    // MARK: Thread

    private var thread: some View {
        let messages = model.messages
        let last = messages.last
        let failed: Bool = { if case .failed = model.status { return true } else { return false } }()
        // Room under the sent message so it can sit at the top while the reply is short.
        let spacer: CGFloat = pinned == nil ? 0 : max(0, viewport - (pinnedTop.map { endY - $0 } ?? 0) - 44)

        return VStack(alignment: .leading, spacing: 26) {
            ForEach(Array(messages.enumerated()), id: \.element.key) { i, m in
                row(m, isLast: i == messages.count - 1, failed: failed)
                    .id(m.key)
                    .background {
                        if m.key == pinned {
                            Color.clear.onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("thread")).minY } action: { pinnedTop = $0 }
                        }
                    }
            }
            if model.status == .sending, last?.role == "user" {
                ThinkingRow().transition(.opacity)
            }
            if failed, last?.role != "assistant" {
                ThinkingRow(error: true, message: model.failure, onRetry: { model.retry() })
            }
            Color.clear.frame(height: 1)
                .id("end")
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("thread")).minY } action: { endY = $0 }
                // Where the end is on screen, against where the composer starts: both real
                // positions in the window, so no insets to get wrong.
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { y in
                    end.top = y
                    updateEndInView()
                }
            Color.clear.frame(height: spacer)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 20)
        .coordinateSpace(.named("thread"))
        .animation(.easeOut(duration: 0.18), value: model.status == .sending)
    }

    @ViewBuilder
    private func row(_ m: ChatMessage, isLast: Bool, failed: Bool) -> some View {
        if m.role == "user" {
            if let from = m.metadata.from {
                InboundMessage(message: m, from: from)
            } else {
                UserBubble(message: m)
            }
        } else {
            AssistantMessageView(
                message: m,
                isLast: isLast,
                streaming: isLast && model.busy,
                errored: isLast && failed,
                model: model
            )
        }
    }

    private func jumpButton(_ proxy: ScrollViewProxy) -> some View {
        let show = !endInView && !showsWelcome
        return Button {
            withAnimation(Motion.morph) { proxy.scrollTo("end", anchor: .bottom) }
        } label: {
            Image(systemName: "arrow.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 38, height: 38)
                .opalGlass(in: Circle(), interactive: true)
        }
        .buttonStyle(PressableStyle(scale: 0.92))
        .accessibilityLabel("Scroll to latest")
        .padding(.bottom, 10)
        .opacity(show ? 1 : 0)
        .scaleEffect(show ? 1 : 0.92)
        .offset(y: show ? 0 : 4)
        .allowsHitTesting(show)
        .animation(.easeOut(duration: 0.2), value: show)
    }

    // MARK: Header

    private var header: some View {
        ScreenHeader {
            if let agent = model.agent {
                Button { showAgent = true } label: {
                    HStack(spacing: 8) {
                        AgentFace(shape: agent.shape, color: agent.color, size: 22, working: model.busy, seed: agent.name)
                        Text(agent.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    }
                    .foregroundStyle(.primary)
                    .padding(.leading, 10)
                    .padding(.trailing, 16)
                    .frame(height: 40)
                    .opalGlass(in: Capsule(), interactive: true)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(agent.name), details")
            } else if !model.title.isEmpty {
                HeaderTitle(text: model.title)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        } trailing: {
            HStack(spacing: 10) {
                if !model.sandboxes.isEmpty || model.agentId != nil {
                    GlassIconButton("display", accessibility: "Agent computer") { showComputer = true }
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
                if model.agentId == nil {
                    GlassIconButton("square.and.pencil", accessibility: "New chat") { shell.newChat() }
                }
            }
        }
        .animation(Motion.morph, value: model.title)
        .animation(Motion.morph, value: model.sandboxes.isEmpty)
    }

    // MARK: Empty state

    private var welcome: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            Group {
                if let agent = model.agent {
                    VStack(spacing: 12) {
                        AgentFace(shape: agent.shape, color: agent.color, size: 64, seed: agent.name)
                        Text("Message \(agent.name)")
                            .font(.system(size: 24, weight: .medium))
                            .tracking(-0.3)
                        Text("\(agent.name) has its own computer and can use every tool.")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                } else {
                    HStack(spacing: 11) {
                        OpalMark(size: 28).foregroundStyle(Color.ink)
                        Text(greeting)
                            .font(.system(size: 26, weight: .medium))
                            .tracking(-0.4)
                            .foregroundStyle(Color.primary.opacity(0.9))
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .padding(.horizontal, 24)
            .opacity(welcomeShown ? 1 : 0)
            .blur(radius: welcomeShown || reduceMotion ? 0 : 6)
            .offset(y: welcomeShown || reduceMotion ? 0 : 8)
            .animation(.easeOut(duration: 0.45), value: welcomeShown)
            Spacer(minLength: 40)
            if model.agentId == nil {
                VStack(alignment: .leading, spacing: 2) {
                    suggestion("Study your course material", systemImage: "book", index: 0) { model.studyMode = true }
                    suggestion("Hand a task to agents", systemImage: "person.3", index: 1) { model.useAgents = true }
                    suggestion("Answer in my handwriting", systemImage: "signature", index: 2) { model.handwriting = true }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
            }
        }
        .containerRelativeFrame(.vertical)
        // Animated where it's used (above), not with withAnimation here: an animation started in
        // onAppear also animates whatever else changes in the same pass.
        .onAppear { welcomeShown = true }
    }

    private func suggestion(_ title: String, systemImage: String, index: Int, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.morph) { action() }
            // After the tap has finished (the window's tap-to-dismiss sees the same tap).
            Task { @MainActor in focused = true }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 17))
                    .frame(width: 24)
                Text(title).font(.system(size: 17))
            }
            .foregroundStyle(Color.primary.opacity(0.85))
            .padding(.horizontal, 12)
            .frame(height: 46)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle(scale: 0.97))
        .opacity(welcomeShown ? 1 : 0)
        .offset(y: welcomeShown || reduceMotion ? 0 : 10)
        .animation(.easeOut(duration: 0.4).delay(0.12 + Double(index) * 0.05), value: welcomeShown)
    }

    // MARK: Composer

    private var canSend: Bool {
        guard !model.uploading else { return false }
        let hasFile = model.attachments.contains { if case .ready = $0.state { return true } else { return false } }
        return hasFile || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var chips: [ComposerChip] {
        var c: [ComposerChip] = []
        if model.studyMode { c.append(ComposerChip(id: "study", label: "Study", systemImage: "book", remove: { model.studyMode = false })) }
        if model.useAgents { c.append(ComposerChip(id: "agents", label: "Agents", systemImage: "person.3", remove: { model.useAgents = false })) }
        if model.handwriting { c.append(ComposerChip(id: "handwriting", label: "Handwriting", systemImage: "signature", remove: { model.handwriting = false })) }
        return c
    }

    private var placeholder: String {
        if let agent = model.agent { return "Message \(agent.name)" }
        return model.studyMode ? "Ask about your course material" : "Ask Opal"
    }

    private var composerStack: some View {
        VStack(spacing: 0) {
            if let items = suggestions, !items.isEmpty {
                SuggestList(items: items) { pick($0) }
                    .padding(.horizontal, 12)
                    .transition(.opacity.combined(with: .offset(y: 8)).combined(with: .scale(scale: 0.98, anchor: .bottom)))
            }
            composer
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { top in
                    let old = end.bottom
                    end.bottom = top
                    // The keyboard pushed the composer up while the latest message was in view:
                    // keep it in view.
                    if old < .greatestFiniteMagnitude, top < old - 1, end.top <= old + 60, !showsWelcome {
                        // A moment later, once the scroll view has taken the keyboard's room;
                        // right away there's nowhere to scroll to yet.
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(40))
                            withAnimation(.easeOut(duration: 0.25)) { scroller?.scrollTo("end", anchor: .bottom) }
                        }
                    }
                    updateEndInView()
                }
        }
        .animation(Motion.dismiss, value: suggestions?.isEmpty ?? true)
    }

    private func updateEndInView() {
        let inView = end.top <= end.bottom + 60
        if inView != endInView { endInView = inView }
    }

    private var composer: some View {
        Composer(
            text: $draft,
            placeholder: placeholder,
            busy: model.busy,
            canSend: canSend,
            chips: chips,
            attachments: model.attachments,
            onRemoveAttachment: { model.removeAttachment($0) },
            menuOpen: $menuOpen,
            focus: $focused,
            onSend: send,
            onStop: { model.stop() }
        )
    }

    @ViewBuilder private var plusMenu: some View {
        switch menuPage {
        case .main:
            VStack(alignment: .leading, spacing: 0) {
                MenuRow(title: "Camera", systemImage: "camera", index: 0) {
                    withAnimation(Motion.panel) { menuPage = .camera }
                }
                MenuRow(title: "Photos", systemImage: "photo.on.rectangle", index: 1) { closeMenu(); pickingPhotos = true }
                MenuRow(title: "Files", systemImage: "paperclip", index: 2) { closeMenu(); pickingFiles = true }
                Divider().padding(.horizontal, 10).padding(.vertical, 4)
                MenuRow(title: "Study", subtitle: "Your books, quizzes and flashcards", systemImage: "book", checked: model.studyMode, index: 3) {
                    toggle { model.studyMode.toggle() }
                }
                if model.agentId == nil {
                    MenuRow(title: "Use agents", subtitle: "Hand the task to agents", systemImage: "person.3", checked: model.useAgents, index: 4) {
                        toggle { model.useAgents.toggle() }
                    }
                }
                MenuRow(title: "Write by hand", subtitle: "Answer in your handwriting", systemImage: "signature", checked: model.handwriting, index: 5) {
                    toggle { model.handwriting.toggle() }
                }
                if !session.models.isEmpty {
                    Divider().padding(.horizontal, 10).padding(.vertical, 4)
                    MenuRow(title: "Model", systemImage: "cpu", value: currentModelLabel, index: 6) {
                        withAnimation(Motion.morph) { menuPage = .models }
                    }
                }
            }
            .transition(.opacity.combined(with: .offset(x: -16)))
        case .models:
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(Motion.morph) { menuPage = .main }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                        Text("Model").font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 10)
                    .frame(height: 40)
                    .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(sortedModels.enumerated()), id: \.element.id) { i, m in
                            MenuRow(title: m.label, subtitle: m.description ?? (m.tier == true ? nil : m.providerLabel), systemImage: m.tier == true ? "sparkle" : "cpu", checked: m.id == currentModelId, index: i) {
                                model.modelId = m.id
                                closeMenu()
                            }
                        }
                    }
                }
                .frame(maxHeight: 380)
                .scrollBounceBehavior(.basedOnSize)
            }
            .transition(.opacity.combined(with: .offset(x: 16)))
        case .camera:
            CameraPanel(onPhoto: addCameraPhoto, onClose: closeMenu)
                .transition(.opacity)
        }
    }

    private var sortedModels: [ModelInfo] {
        session.models.filter { $0.tier == true } + session.models.filter { $0.tier != true }
    }

    private var currentModelId: String? { model.modelId ?? session.defaultModelId }

    private var currentModelLabel: String {
        session.models.first { $0.id == currentModelId }?.label ?? "Auto"
    }

    private func toggle(_ change: () -> Void) {
        withAnimation(Motion.morph) { change() }
        closeMenu()
    }

    private func closeMenu() {
        withAnimation(Motion.dismiss) {
            menuOpen = false
            menuPage = .main
        }
    }

    private func send() {
        let text = draft
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Flight.launch(trimmed)
        guard let id = model.send(text) else { return }
        draft = ""
        pinnedTop = nil
        pinned = id
    }

    // MARK: "/" commands and "@" mentions

    private enum Trigger: Equatable {
        case slash(String)
        case mention(String, range: Range<String.Index>)
    }

    private var trigger: Trigger? {
        if draft.hasPrefix("/"), !draft.contains(where: \.isWhitespace) {
            return .slash(String(draft.dropFirst()).lowercased())
        }
        guard model.agentId == nil, let at = draft.lastIndex(of: "@") else { return nil }
        if at > draft.startIndex, !draft[draft.index(before: at)].isWhitespace { return nil }
        let word = draft[draft.index(after: at)...]
        guard !word.contains(where: \.isWhitespace) else { return nil }
        return .mention(String(word).lowercased(), range: at..<draft.endIndex)
    }

    private var suggestions: [SuggestItem]? {
        guard focused, let trigger else { return nil }
        switch trigger {
        case .slash(let q):
            return commands.filter { q.isEmpty || $0.id.hasPrefix(q) || $0.label.lowercased().contains(q) || $0.keywords.contains(q) }
        case .mention(let q, _):
            return shell.agents
                .filter { q.isEmpty || $0.name.lowercased().contains(q) }
                .prefix(8)
                .map { SuggestItem(id: "agent:\($0.name)", label: $0.name, hint: nil, systemImage: nil, agent: $0) }
        }
    }

    private var commands: [SuggestItem] {
        var list: [SuggestItem] = [
            SuggestItem(id: "files", label: "Add photos and files", hint: "/files", systemImage: "paperclip", keywords: "attach upload photo image file pdf"),
            SuggestItem(id: "study", label: model.studyMode ? "Turn off study mode" : "Study mode", hint: "/study", systemImage: "book", keywords: "learn book course school"),
        ]
        if model.agentId == nil {
            list.append(SuggestItem(id: "agents", label: model.useAgents ? "Stop using agents" : "Use agents", hint: "/agents", systemImage: "person.3", keywords: "delegate parallel team"))
        }
        list += [
            SuggestItem(id: "handwriting", label: model.handwriting ? "Stop writing by hand" : "Write by hand", hint: "/handwriting", systemImage: "signature", keywords: "hand write notes pen"),
            SuggestItem(id: "quiz", label: "Make a quiz", hint: "/quiz", systemImage: "checklist", keywords: "test questions exam"),
            SuggestItem(id: "flashcards", label: "Make flashcards", hint: "/flashcards", systemImage: "rectangle.on.rectangle", keywords: "cards memorize"),
        ]
        if !session.models.isEmpty {
            list.append(SuggestItem(id: "model", label: "Choose a model", hint: "/model", systemImage: "cpu", keywords: "llm switch lightning thinking"))
        }
        list.append(SuggestItem(id: "new", label: "New chat", hint: "/new", systemImage: "square.and.pencil", keywords: "clear fresh start"))
        list += skills.map { SuggestItem(id: "skill:\($0.name)", label: $0.name, hint: "Skill", systemImage: "wand.and.stars", keywords: "skill \($0.description.lowercased())") }
        return list
    }

    private func pick(_ item: SuggestItem) {
        if item.id.hasPrefix("agent:"), case .mention(_, let range) = trigger {
            draft.replaceSubrange(range, with: "@\(item.label) ")
            return
        }
        if item.id.hasPrefix("skill:") {
            draft = "/\(item.label) "
            return
        }
        switch item.id {
        case "files": draft = ""; menuOpen = false; pickingFiles = true
        case "study": draft = ""; withAnimation(Motion.morph) { model.studyMode.toggle() }
        case "agents": draft = ""; withAnimation(Motion.morph) { model.useAgents.toggle() }
        case "handwriting": draft = ""; withAnimation(Motion.morph) { model.handwriting.toggle() }
        case "quiz", "flashcards":
            if !model.studyMode { withAnimation(Motion.morph) { model.studyMode = true } }
            draft = item.id == "quiz" ? "Make a quiz about " : "Make flashcards about "
        case "model":
            draft = ""
            focused = false
            menuPage = .models
            withAnimation(Motion.pop) { menuOpen = true }
        case "new": draft = ""; shell.newChat()
        default: break
        }
    }

    private func loadSkills() async {
        struct Res: Decodable { let skills: [SlashSkill] }
        skills = ((try? await session.api.send("/api/skills", as: Res.self).skills) ?? []).filter(\.enabled)
    }

    // MARK: Attachments

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for (i, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
            let scaled = image.scaledDown(maxSide: 2048)
            guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else { continue }
            model.attach(data: jpeg, filename: "photo-\(i + 1).jpg", mediaType: "image/jpeg", preview: scaled.scaledDown(maxSide: 240))
        }
    }

    private func addCameraPhoto(_ data: Data) {
        defer { closeMenu() }
        guard let image = UIImage(data: data) else { return }
        let scaled = image.scaledDown(maxSide: 2048)
        guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else { return }
        let n = model.attachments.count + 1
        model.attach(data: jpeg, filename: "camera-\(n).jpg", mediaType: "image/jpeg", preview: scaled.scaledDown(maxSide: 240))
    }

    private func addFiles(_ urls: [URL]) {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)
            let mime = type?.preferredMIMEType ?? "application/octet-stream"
            let preview = type?.conforms(to: .image) == true ? UIImage(data: data)?.scaledDown(maxSide: 240) : nil
            model.attach(data: data, filename: url.lastPathComponent, mediaType: mime, preview: preview)
        }
    }
}

/// Where something is on screen, updated as it scrolls. A plain object, so writing it from a
/// geometry callback doesn't redraw the view that holds it.
final class ScrollMark {
    /// The end of the content, in window coordinates.
    var top: CGFloat = 0
    /// Where the composer starts, in window coordinates (the bottom of what you can read).
    var bottom: CGFloat = .greatestFiniteMagnitude
}

/// One of your skills, for the "/" list.
struct SlashSkill: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let enabled: Bool

    init(from decoder: any Decoder) throws {
        enum K: String, CodingKey { case id, name, description, enabled }
        let c = try decoder.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true
    }
}

extension View {
    /// Opens a scroll view at its end (the latest message) without pinning it there afterwards.
    @ViewBuilder
    func startsAtBottom() -> some View {
        if #available(iOS 18.0, *) {
            self.defaultScrollAnchor(.bottom, for: .initialOffset)
        } else {
            self
        }
    }

}

// MARK: Suggestions

struct SuggestItem: Identifiable {
    let id: String
    let label: String
    var hint: String?
    var systemImage: String?
    var keywords = ""
    var agent: Agent?
}

/// The "/" and "@" list above the composer: a glass card of rows, newest-first from the bottom.
struct SuggestList: View {
    let items: [SuggestItem]
    let onPick: (SuggestItem) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(items) { item in
                    Button { onPick(item) } label: {
                        HStack(spacing: 12) {
                            Group {
                                if let agent = item.agent {
                                    AgentFace(shape: agent.shape, color: agent.color, size: 20, seed: agent.name)
                                } else {
                                    Image(systemName: item.systemImage ?? "circle").font(.system(size: 15))
                                }
                            }
                            .frame(width: 24)
                            Text(item.label).font(.system(size: 16)).lineLimit(1)
                            Spacer(minLength: 8)
                            if let hint = item.hint {
                                Text(hint).font(.system(size: 13, design: hint.hasPrefix("/") ? .monospaced : .default)).foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 14)
                        .frame(height: 46)
                        .contentShape(.rect)
                    }
                    .buttonStyle(MenuRowStyle())
                }
            }
            .padding(6)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: min(CGFloat(items.count) * 46 + 12, 290))
        .opalGlass(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .sensoryFeedback(.selection, trigger: items.count)
    }
}

// MARK: User messages

/// What you sent: files on top, then the text in a bubble. A message you just sent flies in from
/// where it was typed (the web's send animation): it starts over the composer's text and moves
/// into place while the bubble fades in around it.
struct UserBubble: View {
    let message: ChatMessage
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var waiting: Bool
    @State private var start: CGSize = .zero
    @State private var landed: Bool

    private static let curve = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.42)

    init(message: ChatMessage) {
        self.message = message
        let flying = Flight.expects(message.text)
        _waiting = State(initialValue: flying)
        _landed = State(initialValue: !flying)
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            let files = message.parts.compactMap { p -> SentFile? in
                if case .file(let id, let url, let type, let name) = p { return SentFile(id: id, url: url, mediaType: type, filename: name) } else { return nil }
            }
            if !files.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(files) { f in
                            // Tap to open it in Quick Look.
                            OpenableFile(path: f.url, name: f.filename) { loading in
                                if f.mediaType.hasPrefix("image/") {
                                    AuthedImage(path: f.url)
                                        .frame(width: 120, height: 120)
                                        .clipShape(.rect(cornerRadius: 16, style: .continuous))
                                        .opacity(loading ? 0.6 : 1)
                                } else {
                                    Label(f.filename, systemImage: "doc")
                                        .font(.footnote)
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                        .padding(.horizontal, 12)
                                        .frame(height: 36)
                                        .background(Color.wash, in: Capsule())
                                        .opacity(loading ? 0.6 : 1)
                                }
                            }
                        }
                    }
                }
                .scrollClipDisabled()
                .flipsForRightToLeftLayoutDirection(true)
                .environment(\.layoutDirection, .rightToLeft)
            }
            if !message.text.isEmpty {
                Text(message.text)
                    .font(.system(size: 17))
                    .lineSpacing(2)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .background {
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(Color.bubble)
                            .opacity(landed ? 1 : 0)
                    }
                    .offset(landed ? .zero : start)
                    .opacity(waiting ? 0 : 1)
                    .animation(reduceMotion ? .easeOut(duration: 0.15) : Self.curve, value: landed)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rect in
                        guard waiting else { return }
                        launch(to: rect)
                    }
                    .contextMenu {
                        Button { UIPasteboard.general.string = message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                    }
            }
        }
        .padding(.leading, 48)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func launch(to rect: CGRect) {
        guard let from = Flight.take(message.text), !reduceMotion else {
            waiting = false
            landed = true
            return
        }
        // Text inside the bubble sits 15pt in and 10pt down; line it up with the composer's.
        start = CGSize(width: from.minX - (rect.minX + 15), height: from.minY - (rect.minY + 10))
        waiting = false
        // Shown once at the start, then let go on the next frame so it animates from there.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(16))
            landed = true
        }
    }
}

/// A file sent with a message, as the message row shows it.
private struct SentFile: Identifiable {
    let id: String
    let url: String
    let mediaType: String
    let filename: String
}

extension UIImage {
    /// The same picture, no larger than `maxSide` points on its longest side.
    func scaledDown(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let factor = maxSide / longest
        let target = CGSize(width: size.width * factor, height: size.height * factor)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

/// An image from Opal (attachments need the session, so AsyncImage can't load them). Also takes
/// `data:` URLs (agent screenshots) and plain https links.
struct AuthedImage: View {
    let path: String
    var fit = false
    @Environment(SessionStore.self) private var session
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                if fit {
                    Image(uiImage: image).resizable().scaledToFit().transition(.opacity)
                } else {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                }
            } else {
                Color.wash
            }
        }
        .animation(.easeOut(duration: 0.2), value: image != nil)
        .task(id: path) { image = await Self.load(path, api: session.api) }
    }

    static func load(_ path: String, api: APIClient) async -> UIImage? {
        if path.hasPrefix("data:"), let comma = path.firstIndex(of: ",") {
            let b64 = String(path[path.index(after: comma)...])
            return Data(base64Encoded: b64, options: .ignoreUnknownCharacters).flatMap(UIImage.init(data:))
        }
        if path.hasPrefix("http"), let url = URL(string: path), url.host() != Config.baseURL.host() {
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return UIImage(data: data)
        }
        return (try? await api.data(path)).flatMap(UIImage.init(data:))
    }
}

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

// MARK: Agent computer

/// What an agent's computer shows: the browser, the terminal and the files in its workspace (the
/// web's sandbox panel). Live frames come from the chat; the rest from the server.
struct ComputerSheet: View {
    let frames: [SandboxFrame]
    let agentId: String?
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var focus: String?
    @State private var tab = "browser"
    @State private var remote: Remote?

    struct Remote: Decodable, Equatable {
        struct File: Decodable, Equatable { let type: String; let path: String; let size: Int }
        let status: String
        let lastUrl: String?
        let lastScreenshot: String?
        let files: [File]?
    }

    private var active: String? { focus ?? frames.first?.agentId ?? agentId }
    private var live: SandboxFrame? { frames.first { $0.agentId == active } }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if frames.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(frames) { f in
                                Button { focus = f.agentId } label: {
                                    HStack(spacing: 6) {
                                        AgentFace(shape: f.shape, color: f.color, size: 16, seed: f.agentName)
                                        Text(f.agentName).font(.system(size: 14))
                                    }
                                    .padding(.horizontal, 12)
                                    .frame(height: 32)
                                    .background(f.agentId == active ? Color.wash : .clear, in: Capsule())
                                }
                                .buttonStyle(PressableStyle())
                                .foregroundStyle(.primary)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 8)
                }
                Picker("View", selection: $tab) {
                    Text("Browser").tag("browser")
                    Text("Terminal").tag("terminal")
                    Text("Files").tag("files")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                ScrollView {
                    Group {
                        switch tab {
                        case "terminal": terminal
                        case "files": files
                        default: browser
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .navigationTitle(live?.agentName ?? "Agent computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task(id: active) { await poll() }
    }

    private var browser: some View {
        let shot = live?.screenshot ?? remote?.lastScreenshot
        let url = live?.url ?? remote?.lastUrl
        return VStack(alignment: .leading, spacing: 10) {
            if let url {
                HStack(spacing: 6) {
                    Circle().fill(Color.success).frame(width: 6, height: 6)
                    Text(url).font(.system(size: 12.5, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.wash, in: .rect(cornerRadius: 9, style: .continuous))
            }
            if let shot {
                AuthedImage(path: shot, fit: true)
                    .clipShape(.rect(cornerRadius: 10, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.primary.opacity(0.08)) }
            } else {
                Text("The browser hasn't opened a page yet.").font(.system(size: 14)).foregroundStyle(.secondary)
            }
        }
    }

    private var terminal: some View {
        Group {
            if let log = live?.terminal, !log.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(log.enumerated()), id: \.offset) { _, t in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("$ \(t.command)").foregroundStyle(Color(hex: "#8ec2ff"))
                            if !t.output.isEmpty { Text(t.output).foregroundStyle(Color(hex: "#cfcfcf")) }
                            if t.exitCode != 0 { Text("exit \(t.exitCode)").foregroundStyle(Color(hex: "#ff8a8a")) }
                        }
                    }
                }
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: "#111111"), in: .rect(cornerRadius: 12, style: .continuous))
            } else {
                Text("No commands yet.").font(.system(size: 14)).foregroundStyle(.secondary)
            }
        }
    }

    private var files: some View {
        Group {
            if let list = remote?.files, !list.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(list, id: \.path) { f in
                        HStack(spacing: 8) {
                            Image(systemName: f.type == "dir" ? "folder" : "doc").font(.system(size: 13)).foregroundStyle(.secondary)
                            Text(f.path.split(separator: "/").last.map(String.init) ?? f.path).lineLimit(1)
                            Spacer(minLength: 8)
                            if f.type != "dir" { Text(Self.size(f.size)).font(.system(size: 11).monospacedDigit()).foregroundStyle(.tertiary) }
                        }
                        .font(.system(size: 13, design: .monospaced))
                        .padding(.leading, CGFloat(max(0, f.path.split(separator: "/").count - 1)) * 14)
                    }
                }
            } else {
                Text("The workspace is empty.").font(.system(size: 14)).foregroundStyle(.secondary)
            }
            if session.nerdMode, let remote {
                Text("container status: \(remote.status)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.tertiary).padding(.top, 12)
            }
        }
    }

    private func poll() async {
        guard let active else { return }
        struct Res: Decodable { let sandbox: Remote? }
        while !Task.isCancelled {
            if let r = try? await session.api.send("/api/sandbox/\(active)", as: Res.self) { remote = r.sandbox }
            try? await Task.sleep(for: .seconds(8))
        }
    }

    static func size(_ n: Int) -> String {
        if n < 1024 { return "\(n) B" }
        if n < 1024 * 1024 { return String(format: "%.1f KB", Double(n) / 1024) }
        return String(format: "%.1f MB", Double(n) / 1024 / 1024)
    }
}
