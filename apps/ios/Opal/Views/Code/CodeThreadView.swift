import SwiftUI

/// One Opal Code thread: what the agent said and did, live, with a composer to steer it.
struct CodeThreadView: View {
    let threadId: String
    @Environment(CodeStore.self) private var code
    @Environment(Shell.self) private var shell
    @Environment(SessionStore.self) private var session
    @State private var draft = ""
    @FocusState private var focused: Bool
    @State private var menuOpen = false
    @State private var sendError: String?
    @State private var confirmDelete = false
    @State private var showGit = false
    @State private var skills: [SlashSkill] = []
    /// Whether the end of the thread is on screen. New output only scrolls the thread while it
    /// is, so reading further up is never yanked away.
    @State private var atEnd = true
    /// Where the end and the composer are on screen; not observed, so writing it doesn't redraw.
    @State private var end = ScrollMark()
    /// The thread's scroll proxy, for the composer (which sits outside the scroll view).
    @State private var scroller: ScrollViewProxy?

    private var thread: CodeThread? { code.thread(threadId) }
    private var items: [CodeItem] { code.items[threadId] ?? [] }
    private var working: Bool { thread?.status == "working" }
    private var isGit: Bool { thread.map { code.project($0.projectId)?.isGit ?? ($0.branch != nil) } ?? false }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // A plain VStack: every row has its real height up front, so following the end
                // never lands on an estimate and jumps.
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(items) { item in
                        CodeItemView(item: item, threadId: threadId)
                            .id(item.id)
                            .transition(.opacity.combined(with: .offset(y: 8)))
                    }
                    if working {
                        HStack(spacing: 8) {
                            WorkingMark(size: 14).foregroundStyle(Color.ink)
                            ShimmerText(text: "Working").font(.system(size: 15))
                        }
                        .transition(.opacity)
                    }
                    if let sendError {
                        Label(sendError, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Color.danger)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                        // The end on screen, against where the composer starts (both in window
                        // coordinates, so no insets to get wrong).
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { y in
                            end.top = y
                            updateAtEnd()
                        }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .animation(Motion.morph, value: working)
            }
            .scrollDismissesKeyboard(.interactively)
            .startsAtBottom()
            .onAppear { scroller = proxy }
            .onChange(of: items.count) { _, _ in
                guard atEnd else { return }
                withAnimation(Motion.morph) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: items.last?.data) { _, _ in
                if atEnd { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .overlay(alignment: .bottom) {
                if !atEnd && !items.isEmpty {
                    Button {
                        withAnimation(Motion.morph) { proxy.scrollTo("bottom", anchor: .bottom) }
                    } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.primary)
                            .frame(width: 40, height: 40)
                            .opalGlass(in: Circle(), interactive: true)
                    }
                    .buttonStyle(PressableStyle(scale: 0.92))
                    .accessibilityLabel("Scroll to latest")
                    .padding(.bottom, 10)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(Motion.quick, value: atEnd)
        }
        .overlay { MenuScrim(open: $menuOpen) }
        .bottomBar {
            VStack(spacing: 0) {
                if let list = suggestions, !list.isEmpty {
                    SuggestList(items: list) { pick($0) }
                        .padding(.horizontal, 12)
                        .transition(.opacity.combined(with: .offset(y: 8)).combined(with: .scale(scale: 0.98, anchor: .bottom)))
                }
                Composer(
                    text: $draft,
                    placeholder: working ? "Send a follow-up (it runs after this turn)" : "Message \(CodeAgents.label(thread?.agent ?? "claude"))",
                    busy: working && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    canSend: !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    menuOpen: $menuOpen,
                    focus: $focused,
                    onSend: send,
                    onStop: { Task { await code.interrupt(threadId) } }
                )
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { top in
                    let old = end.bottom
                    end.bottom = top
                    // The keyboard pushed the composer up while the latest output was in view:
                    // keep it there.
                    if old < .greatestFiniteMagnitude, top < old - 1, end.top <= old + 80 {
                        // A moment later, once the scroll view has taken the keyboard's room.
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(40))
                            withAnimation(.easeOut(duration: 0.25)) { scroller?.scrollTo("bottom", anchor: .bottom) }
                        }
                    }
                    updateAtEnd()
                }
            }
            .animation(Motion.dismiss, value: suggestions?.isEmpty ?? true)
        }
        .composerMenu(open: menuOpen) {
            ModeMenu(mode: thread?.mode ?? "auto") { mode in
                Task { await code.patch(threadId, ["mode": .string(mode)]) }
                withAnimation(Motion.dismiss) { menuOpen = false }
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(thread?.title ?? "Thread").font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            if isGit {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showGit = true } label: { Image(systemName: "arrow.triangle.branch") }
                        .accessibilityLabel("Changes")
                }
            }
            ToolbarItem(placement: .topBarTrailing) { actions }
        }
        .sheet(isPresented: $showGit) {
            if let thread {
                GitSheet(thread: thread)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
        .task(id: threadId) { await code.open(threadId) }
        .task { await loadSkills() }
        .confirmationDialog("Delete this thread?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task { await code.delete(threadId) }
                if !shell.path.isEmpty { shell.path.removeLast() }
            }
        } message: {
            Text("The agent stops. Its folder or worktree stays on the machine.")
        }
    }

    private var subtitle: String {
        guard let t = thread else { return "" }
        return [CodeAgents.label(t.agent), code.project(t.projectId)?.name ?? code.machine(t.machineId)?.name, t.branch].compactMap { $0 }.joined(separator: " · ")
    }

    private var actions: some View {
        Menu {
            if let t = thread {
                Button { Task { await code.patch(threadId, ["pinned": .bool(t.pinnedAt == nil)]) } } label: {
                    Label(t.pinnedAt == nil ? "Pin" : "Unpin", systemImage: t.pinnedAt == nil ? "pin" : "pin.slash")
                }
                Button { Task { await code.patch(threadId, ["settled": .bool(t.settledAt == nil)]) } } label: {
                    Label(t.settledAt == nil ? "Settle" : "Unsettle", systemImage: "checkmark.circle")
                }
                if let pr = t.prUrl, let url = URL(string: pr) {
                    Link(destination: url) { Label("Open pull request", systemImage: "arrow.triangle.pull") }
                }
                Divider()
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Thread actions")
    }

    private func updateAtEnd() {
        let next = end.top <= end.bottom + 80
        if next != atEnd { atEnd = next }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        sendError = nil
        atEnd = true
        Task {
            do { try await code.send(text, to: threadId) } catch {
                draft = text
                sendError = error.localizedDescription
            }
        }
    }

    // MARK: "/" skills

    /// "/rev" typed at the very start: Code skills that match. Same rule as the web composer.
    private var suggestions: [SuggestItem]? {
        guard draft.hasPrefix("/"), !draft.contains("\n") else { return nil }
        let q = String(draft.dropFirst()).lowercased()
        guard q.count <= 40 else { return nil }
        // Already picked: "/review " and on to the instructions.
        if skills.contains(where: { q.hasPrefix($0.name.lowercased() + " ") }) { return nil }
        let list = skills.filter(\.enabled).filter { q.isEmpty || "\($0.name) \($0.description)".lowercased().contains(q) }
        return list.prefix(12).map { s in
            let hint = s.description
            return SuggestItem(id: s.id, label: "/\(s.name)", hint: hint.isEmpty ? "Skill" : hint, systemImage: "wand.and.stars")
        }
    }

    private func pick(_ item: SuggestItem) {
        draft = item.label + " "
        focused = true
    }

    private func loadSkills() async {
        struct Res: Decodable { let skills: [SlashSkill] }
        skills = (try? await session.api.send("/api/code/skills", as: Res.self).skills) ?? []
    }
}

// MARK: Git

/// The thread's changes, like the web's diff panel: one section per file, then commit, push and
/// pull request.
struct GitSheet: View {
    let thread: CodeThread
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    struct Status: Decodable {
        let branch: String?
        let base: String?
        let ahead: Int
        let dirty: Bool
        let hasRemote: Bool
    }
    struct Response: Decodable { let status: Status; let diff: String; let truncated: Bool?; let prUrl: String? }
    struct FileDiff: Identifiable { let path: String; let text: String; let add: Int; let del: Int; let isNew: Bool; let isDeleted: Bool; var id: String { path } }

    @State private var data: Response?
    @State private var error: String?
    @State private var busy: String?
    @State private var message = ""
    @State private var toast: Toast?

    private var files: [FileDiff] { Self.parse(data?.diff ?? "") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if data == nil && error == nil {
                        SkeletonBlock(height: 96)
                    }
                    if let error { ErrorNote(text: error) }
                    if let data {
                        if files.isEmpty {
                            Text(data.status.branch == nil ? "Not a Git repository" : "No changes")
                                .font(.system(size: 15))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 30)
                        }
                        ForEach(files) { f in
                            FileSection(file: f, startOpen: files.count <= 6)
                        }
                        if data.truncated == true {
                            Text("The diff is too large to show in full.").font(.system(size: 13)).foregroundStyle(.tertiary)
                        }
                    }
                }
                .padding(16)
                .animation(Motion.morph, value: data?.diff)
            }
            .safeAreaInset(edge: .bottom) {
                if let s = data?.status, s.branch != nil { actions(s) }
            }
            .refreshable { await load() }
            .navigationTitle("Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text("Changes").font(.system(size: 15, weight: .semibold))
                        if let b = data?.status.branch {
                            Text(b).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .toast($toast)
        }
        .task { await load() }
        .onChange(of: thread.status) { _, s in if s != "working" { Task { await load() } } }
    }

    private func actions(_ s: Status) -> some View {
        let prUrl = data?.prUrl ?? thread.prUrl
        return VStack(alignment: .leading, spacing: 10) {
            if s.dirty {
                TextField("Commit message (Opal writes one if empty)", text: $message, axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
            }
            FlowLayout(spacing: 8) {
                if s.dirty {
                    gitButton("Commit", action: "commit")
                }
                if s.hasRemote && (s.ahead > 0 || s.dirty) {
                    gitButton(s.dirty ? "Commit & push" : "Push", action: s.dirty ? "commit_push" : "push")
                }
                if s.hasRemote {
                    if let pr = prUrl, let url = URL(string: pr) {
                        SmallButton(title: "Pull request", systemImage: "arrow.up.right") { openURL(url) }
                    } else {
                        AccentButton(title: "Create PR", pending: busy == "pr" || busy == "commit_push_pr") {
                            Task { await run(s.dirty ? "commit_push_pr" : "pr") }
                        }
                        .disabled(busy != nil)
                    }
                }
            }
            if !s.hasRemote {
                Text("No remote, so push and PRs are off.").font(.system(size: 13)).foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }

    private func gitButton(_ title: String, action: String) -> some View {
        Button { Task { await run(action) } } label: {
            HStack(spacing: 6) {
                if busy == action { ProgressView().controlSize(.small) }
                Text(title).font(.system(size: 15, weight: .medium))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .frame(height: 46)
            .background(Color.wash, in: Capsule())
        }
        .buttonStyle(PressableStyle())
        .disabled(busy != nil)
    }

    private func load() async {
        do {
            let r = try await session.api.send("/api/code/threads/\(thread.id)/git", as: Response.self)
            withAnimation(Motion.morph) {
                data = r
                error = nil
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ action: String) async {
        struct Body: Encodable { let action: String; let message: String? }
        struct Res: Decodable { let sha: String?; let prUrl: String?; let message: String? }
        busy = action
        defer { busy = nil }
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let r = try await session.api.send("/api/code/threads/\(thread.id)/git", method: "POST", json: Body(action: action, message: text.isEmpty ? nil : text), as: Res.self)
            if r.prUrl != nil { toast = Toast(text: "Pull request ready") }
            else if let sha = r.sha { toast = Toast(text: "Committed \(sha)") }
            else { toast = Toast(text: "Pushed") }
            message = ""
            await load()
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }

    /// Splits a unified diff into files (same rules as the web's parseDiff).
    static func parse(_ diff: String) -> [FileDiff] {
        guard !diff.isEmpty else { return [] }
        var out: [FileDiff] = []
        let chunks = diff.components(separatedBy: "\ndiff --git ")
        for (i, raw) in chunks.enumerated() {
            var chunk = raw
            if i == 0 {
                guard chunk.hasPrefix("diff --git ") else { continue }
                chunk.removeFirst("diff --git ".count)
            }
            let header = chunk.prefix { $0 != "\n" }
            let path = header.range(of: " b/").map { String(header[$0.upperBound...]) } ?? String(header)
            let body = chunk.range(of: "@@").map { String(chunk[$0.lowerBound...]) } ?? ""
            var add = 0, del = 0
            for l in body.split(separator: "\n", omittingEmptySubsequences: false) {
                if l.hasPrefix("+") && !l.hasPrefix("+++") { add += 1 } else if l.hasPrefix("-") && !l.hasPrefix("---") { del += 1 }
            }
            let head = chunk.prefix(400)
            out.append(FileDiff(path: path, text: body.trimmingCharacters(in: .newlines), add: add, del: del, isNew: head.contains("\nnew file"), isDeleted: head.contains("\ndeleted file")))
        }
        return out
    }
}

private struct FileSection: View {
    let file: GitSheet.FileDiff
    @State private var open: Bool

    init(file: GitSheet.FileDiff, startOpen: Bool) {
        self.file = file
        _open = State(initialValue: startOpen)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(Motion.morph) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(file.path)
                        .font(.system(size: 13, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.head)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if file.isNew { Text("new").font(.system(size: 11)).foregroundStyle(Color.success) }
                    if file.isDeleted { Text("deleted").font(.system(size: 11)).foregroundStyle(Color.danger) }
                    if file.add > 0 { Text("+\(file.add)").foregroundStyle(Color.success) }
                    if file.del > 0 { Text("−\(file.del)").foregroundStyle(Color.danger) }
                }
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .padding(12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? "Expanded" : "Collapsed")
            if open && !file.text.isEmpty {
                DiffView(diff: file.text).transition(.opacity)
            }
        }
        .background(Color.wash, in: .rect(cornerRadius: 16, style: .continuous))
        .clipShape(.rect(cornerRadius: 16, style: .continuous))
    }
}

/// The permission modes, as rows for a composer menu.
struct ModeMenu: View {
    let mode: String
    let pick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Permissions")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.top, 4)
                .padding(.bottom, 2)
            ForEach(Array(CodeAgents.modes.enumerated()), id: \.offset) { i, m in
                MenuRow(title: m.label, subtitle: m.hint, systemImage: m.icon, checked: m.id == mode, index: i) { pick(m.id) }
            }
        }
    }
}

// MARK: Items

struct CodeItemView: View {
    let item: CodeItem
    let threadId: String
    @Environment(CodeStore.self) private var code
    @State private var open = false

    var body: some View {
        switch item.kind {
        case "user":
            VStack(alignment: .trailing, spacing: 4) {
                if let from = item["from"]?["title"]?.string {
                    Label("From \(from)", systemImage: "arrow.turn.down.right").font(.caption).foregroundStyle(.secondary)
                }
                Text(item.text)
                    .font(.system(size: 16))
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .background(Color.wash, in: .rect(cornerRadius: 22, style: .continuous))
                    .textSelection(.enabled)
            }
            .padding(.leading, 40)
            .frame(maxWidth: .infinity, alignment: .trailing)
        case "assistant":
            StreamingText(text: item.text)
                .font(.system(size: 16))
                .lineSpacing(3)
                .textSelection(.enabled)
        case "reasoning":
            Disclosure(open: $open) {
                Label("Thought", systemImage: "brain").font(.system(size: 14)).foregroundStyle(.secondary)
            } content: {
                Text(item.text).font(.system(size: 14)).foregroundStyle(.secondary)
            }
        case "command":
            CommandCard(item: item)
        case "edit":
            EditCard(item: item)
        case "tool":
            Disclosure(open: $open) {
                HStack(spacing: 6) {
                    Image(systemName: "wrench.and.screwdriver").foregroundStyle(.secondary)
                    Text(item["name"]?.string ?? "Tool").font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(1)
                    StatusIcon(status: item.status)
                }
            } content: {
                VStack(alignment: .leading, spacing: 6) {
                    if let input = item["input"] { Mono(text: input.pretty) }
                    if let output = item["output"]?.string, !output.isEmpty { Mono(text: output) }
                }
            }
        case "approval":
            CodeApprovalCard(item: item, threadId: threadId)
        case "error":
            Label(item.text, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.danger)
        default:
            Text(item.text)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

/// A header that opens to show more, with the chevron turning as it does.
struct Disclosure<Header: View, Content: View>: View {
    @Binding var open: Bool
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(Motion.morph) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    header
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if open {
                content.transition(.opacity.combined(with: .offset(y: -4)))
            }
        }
    }
}

struct StatusIcon: View {
    let status: String
    var body: some View {
        switch status {
        case "running": ProgressView().controlSize(.mini)
        case "failed": Image(systemName: "xmark.circle.fill").foregroundStyle(Color.danger).font(.system(size: 13))
        case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.success).font(.system(size: 13))
        default: EmptyView()
        }
    }
}

/// Monospaced text that scrolls sideways instead of wrapping.
struct Mono: View {
    let text: String
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(10)
        }
        .frame(maxHeight: 280)
        .background(Color.wash, in: .rect(cornerRadius: 12, style: .continuous))
    }
}

struct CommandCard: View {
    let item: CodeItem
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(Motion.morph) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "terminal").font(.system(size: 13)).foregroundStyle(.secondary)
                    Text(item["command"]?.string ?? "")
                        .font(.system(size: 13, design: .monospaced))
                        .lineLimit(open ? 6 : 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let code = item["exitCode"]?.int, code != 0 {
                        Text("exit \(code)").font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundStyle(.red)
                    }
                    StatusIcon(status: item.status)
                }
                .padding(12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if open, let output = item["output"]?.string, !output.isEmpty {
                Divider()
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    Text(output)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 280)
                .transition(.opacity)
            }
        }
        .background(Color.wash, in: .rect(cornerRadius: 16, style: .continuous))
    }
}

struct EditCard: View {
    let item: CodeItem
    @State private var openFile: String?

    private var files: [JSONValue] { item["files"]?.array ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(files.enumerated()), id: \.offset) { i, f in
                let path = f["path"]?.string ?? ""
                let diff = f["diff"]?.string ?? ""
                let counts = Self.counts(diff)
                if i > 0 { Divider() }
                Button {
                    withAnimation(Motion.morph) { openFile = openFile == path ? nil : path }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: icon(f["change"]?.string))
                            .font(.system(size: 13))
                            .foregroundStyle(f["change"]?.string == "delete" ? Color.red : f["change"]?.string == "add" ? Color.green : Color.secondary)
                        Text(Self.short(path))
                            .font(.system(size: 13, design: .monospaced))
                            .lineLimit(1)
                            .truncationMode(.head)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if counts.added > 0 { Text("+\(counts.added)").foregroundStyle(.green) }
                        if counts.removed > 0 { Text("−\(counts.removed)").foregroundStyle(.red) }
                        if i == 0 { StatusIcon(status: item.status) }
                    }
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .padding(12)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(diff.isEmpty)
                if openFile == path, !diff.isEmpty {
                    DiffView(diff: diff).transition(.opacity)
                }
            }
        }
        .background(Color.wash, in: .rect(cornerRadius: 16, style: .continuous))
        .clipShape(.rect(cornerRadius: 16, style: .continuous))
    }

    private func icon(_ change: String?) -> String {
        switch change {
        case "add": "plus.circle"
        case "delete": "minus.circle"
        default: "pencil.circle"
        }
    }

    static func short(_ path: String) -> String {
        let parts = path.split(separator: "/")
        return parts.suffix(3).joined(separator: "/")
    }

    static func counts(_ diff: String) -> (added: Int, removed: Int) {
        var a = 0, r = 0
        for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("+++") || line.hasPrefix("---") { continue }
            if line.hasPrefix("+") { a += 1 } else if line.hasPrefix("-") { r += 1 }
        }
        return (a, r)
    }
}

/// A unified diff, line by line: additions green, removals red, hunks dimmed.
struct DiffView: View {
    let diff: String

    var body: some View {
        let lines = diff.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            .filter { !$0.hasPrefix("+++") && !$0.hasPrefix("---") && !$0.hasPrefix("diff --git") && !$0.hasPrefix("index ") }
        ScrollView([.horizontal, .vertical], showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.prefix(800).enumerated()), id: \.offset) { _, line in
                    Text(line.isEmpty ? " " : line)
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(lineColor(line))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(lineBackground(line))
                }
            }
            .padding(.vertical, 6)
            .textSelection(.enabled)
        }
        .frame(maxHeight: 360)
        .background(Color.canvas.opacity(0.6))
    }

    private func lineColor(_ l: String) -> Color {
        if l.hasPrefix("@@") { return .secondary }
        if l.hasPrefix("+") { return Color(red: 0.1, green: 0.55, blue: 0.25) }
        if l.hasPrefix("-") { return Color(red: 0.75, green: 0.2, blue: 0.2) }
        return .primary
    }

    private func lineBackground(_ l: String) -> Color {
        if l.hasPrefix("+") { return .green.opacity(0.1) }
        if l.hasPrefix("-") { return .red.opacity(0.1) }
        return .clear
    }
}

struct CodeApprovalCard: View {
    let item: CodeItem
    let threadId: String
    @Environment(CodeStore.self) private var code
    @State private var sent = false

    var body: some View {
        let status = item.status
        VStack(alignment: .leading, spacing: 10) {
            Label(item["title"]?.string ?? "The agent wants to continue", systemImage: "hand.raised.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(status == "pending" ? Color.orange : Color.secondary)
            if let detail = item["detail"]?.string, !detail.isEmpty {
                Text(detail).font(.system(size: 14)).foregroundStyle(.secondary)
            }
            if let command = item["command"]?.string, !command.isEmpty {
                Mono(text: command)
            }
            if status == "pending" {
                HStack(spacing: 8) {
                    decision("Deny", "deny", prominent: false)
                    Spacer()
                    decision("Always", "allow_session", prominent: false)
                    decision("Allow", "allow", prominent: true)
                }
                .disabled(sent)
            } else {
                Text(status == "approved" ? "Allowed" : status == "denied" ? "Denied" : "Expired")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(status == "pending" ? Color.orange.opacity(0.08) : Color.wash, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay {
            if status == "pending" {
                RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.orange.opacity(0.35), lineWidth: 1)
            }
        }
        .sensoryFeedback(.success, trigger: sent)
    }

    private func decision(_ title: String, _ value: String, prominent: Bool) -> some View {
        Button {
            sent = true
            Task { await code.respond(threadId, requestId: item["requestId"]?.string ?? "", decision: value) }
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(prominent ? Color.canvas : Color.primary)
                .padding(.horizontal, 16)
                .frame(height: 38)
                .background(prominent ? Color.ink : Color.wash, in: Capsule())
        }
        .buttonStyle(PressableStyle())
    }
}
