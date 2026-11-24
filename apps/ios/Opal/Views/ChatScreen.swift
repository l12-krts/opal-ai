import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ChatScreen: View {
    @State var model: ChatModel
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

    private enum MenuPage { case main, models, camera }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if model.messages.isEmpty && !model.busy {
                    welcome
                } else {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        ForEach(model.messages) { m in
                            MessageRow(message: m, model: model)
                                .id(m.id)
                                .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                        }
                        if case .sending = model.status {
                            HStack(spacing: 8) {
                                WorkingMark(size: 15).foregroundStyle(Color.ink)
                                ShimmerText(text: "Thinking").font(.system(size: 16))
                            }
                            .transition(.opacity)
                        }
                        if case .failed(let msg) = model.status {
                            Label(msg, systemImage: "exclamationmark.circle")
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: model.messages.count) { withAnimation(Motion.morph) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: model.messages.last?.parts.count) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: model.messages.last?.text) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .overlay { MenuScrim(open: Binding(get: { menuOpen }, set: { if !$0 { closeMenu() } })) }
        .topBar { header }
        .bottomBar { composer }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .onAppear { greeting = Greeting.now(name: session.userName) }
        .onChange(of: session.userName) { _, name in greeting = Greeting.now(name: name) }
        .onChange(of: model.busy) { _, busy in if !busy { onActivity() } }
        .onChange(of: menuOpen) { _, open in if !open { menuPage = .main } }
        .photosPicker(isPresented: $pickingPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { addFiles(urls) }
        }
    }

    // MARK: Header

    private var header: some View {
        ScreenHeader {
            if !model.title.isEmpty {
                Text(model.title)
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .opalGlass(in: Capsule())
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        } trailing: {
            if model.agentId == nil {
                GlassIconButton("square.and.pencil", accessibility: "New chat") { shell.newChat() }
            }
        }
        .animation(Motion.morph, value: model.title)
    }

    // MARK: Empty state

    private var welcome: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            HStack(spacing: 11) {
                OpalMark(size: 28).foregroundStyle(Color.ink)
                Text(greeting)
                    .font(.system(size: 26, weight: .medium))
                    .tracking(-0.4)
                    .foregroundStyle(Color.primary.opacity(0.9))
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .opacity(welcomeShown ? 1 : 0)
            .blur(radius: welcomeShown || reduceMotion ? 0 : 6)
            .offset(y: welcomeShown || reduceMotion ? 0 : 8)
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
        .onAppear {
            withAnimation(.easeOut(duration: 0.45)) { welcomeShown = true }
        }
    }

    private func suggestion(_ title: String, systemImage: String, index: Int, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.morph) { action() }
            focused = true
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

    private var composer: some View {
        Composer(
            text: $draft,
            placeholder: model.studyMode ? "Ask about your course material" : "Ask Opal",
            busy: model.busy,
            canSend: canSend,
            chips: chips,
            attachments: model.attachments,
            onRemoveAttachment: { model.removeAttachment($0) },
            menuOpen: $menuOpen,
            menuExpanded: menuPage == .camera,
            focus: $focused,
            onSend: send,
            onStop: { model.stop() }
        ) {
            plusMenu
        }
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
                MenuRow(title: "Use agents", subtitle: "Hand the task to agents", systemImage: "person.3", checked: model.useAgents, index: 4) {
                    toggle { model.useAgents.toggle() }
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
        draft = ""
        model.send(text)
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

/// A file sent with a message, as the message row shows it.
private struct SentFile: Identifiable {
    let id: String
    let url: String
    let mediaType: String
    let filename: String
}

struct MessageRow: View {
    let message: ChatMessage
    let model: ChatModel

    var body: some View {
        if message.role == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                let files = message.parts.compactMap { p -> SentFile? in
                    if case .file(let id, let url, let type, let name) = p { return SentFile(id: id, url: url, mediaType: type, filename: name) } else { return nil }
                }
                if !files.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(files) { f in
                            if f.mediaType.hasPrefix("image/") {
                                AuthedImage(path: f.url)
                                    .frame(width: 120, height: 120)
                                    .clipShape(.rect(cornerRadius: 16, style: .continuous))
                            } else {
                                Label(f.filename, systemImage: "doc")
                                    .font(.footnote)
                                    .lineLimit(1)
                                    .padding(.horizontal, 12)
                                    .frame(height: 36)
                                    .background(Color.wash, in: Capsule())
                            }
                        }
                    }
                }
                if !message.text.isEmpty {
                    Text(message.text)
                        .font(.system(size: 17))
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .background(Color.wash, in: .rect(cornerRadius: 22, style: .continuous))
                        .textSelection(.enabled)
                }
            }
            .padding(.leading, 48)
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(message.parts) { part in
                    PartView(part: part, model: model)
                }
            }
        }
    }
}

/// An image from Opal (attachments need the session, so AsyncImage can't load them).
struct AuthedImage: View {
    let path: String
    @Environment(SessionStore.self) private var session
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
            } else {
                Color.wash
            }
        }
        .animation(.easeOut(duration: 0.2), value: image != nil)
        .task(id: path) {
            if let data = try? await session.api.data(path) { image = UIImage(data: data) }
        }
    }
}

struct PartView: View {
    let part: Part
    let model: ChatModel
    @State private var open = false

    var body: some View {
        switch part {
        case .text(_, let text):
            StreamingText(text: text)
                .font(.system(size: 17))
                .lineSpacing(3)
                .textSelection(.enabled)
        case .reasoning(_, let text):
            DisclosureGroup("Thinking", isExpanded: $open) {
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
            .font(.subheadline).foregroundStyle(.secondary)
        case .route(let route, _):
            if route == "agents" {
                Label("Delegated to agents", systemImage: "person.3").font(.caption).foregroundStyle(.secondary)
            }
        case .agent(let run):
            AgentRunCard(run: run)
        case .agentMessage(_, let from, let to, let text):
            Text("\(from) to \(to): \(text)").font(.footnote).foregroundStyle(.secondary)
        case .tool(let id, let name, let state, let input, let output, let error, let approvalId):
            ToolPartView(id: id, name: name, state: state, input: input, output: output, error: error, approvalId: approvalId, model: model)
        case .file:
            EmptyView()
        }
    }
}

struct AgentRunCard: View {
    let run: AgentRun
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Circle().fill(Color(hex: run.color)).frame(width: 20, height: 20)
                        .overlay(Text(run.name.prefix(1)).font(.caption2.weight(.semibold)).foregroundStyle(.white))
                    Text(run.name).font(.subheadline.weight(.medium))
                    Text(run.status == "running" ? (run.steps.last?.label ?? "Starting") : run.status == "error" ? "Failed" : "Done")
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if run.status == "running" { ProgressView().controlSize(.small) }
                    Image(systemName: "chevron.right").rotationEffect(.degrees(open ? 90 : 0)).foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
            if open {
                Text(run.task).font(.footnote).foregroundStyle(.secondary)
                ForEach(Array(run.steps.enumerated()), id: \.offset) { _, s in
                    Text("• \(s.label)").font(.footnote)
                }
                if let r = run.result { Text(r).font(.callout) }
            }
        }
        .padding(12)
        .background(.fill.quinary, in: .rect(cornerRadius: 12))
    }
}

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
