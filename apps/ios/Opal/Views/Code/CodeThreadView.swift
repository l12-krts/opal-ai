import SwiftUI

/// One Opal Code thread: what the agent said and did, live, with a composer to steer it.
struct CodeThreadView: View {
    let threadId: String
    @Environment(CodeStore.self) private var code
    @Environment(Shell.self) private var shell
    @State private var draft = ""
    @FocusState private var focused: Bool
    @State private var menuOpen = false
    @State private var sendError: String?
    @State private var confirmDelete = false

    private var thread: CodeThread? { code.thread(threadId) }
    private var items: [CodeItem] { code.items[threadId] ?? [] }
    private var working: Bool { thread?.status == "working" }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
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
                        Label(sendError, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .animation(Motion.morph, value: working)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: items.count) { withAnimation(Motion.morph) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: items.last?.data) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .overlay { MenuScrim(open: $menuOpen) }
        .bottomBar {
            Composer(
                text: $draft,
                placeholder: "Message \(CodeAgents.label(thread?.agent ?? "claude"))",
                busy: working && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                canSend: !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                menuOpen: $menuOpen,
                focus: $focused,
                onSend: send,
                onStop: { Task { await code.interrupt(threadId) } }
            ) {
                ModeMenu(mode: thread?.mode ?? "auto") { mode in
                    Task { await code.patch(threadId, ["mode": .string(mode)]) }
                    withAnimation(Motion.dismiss) { menuOpen = false }
                }
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
            ToolbarItem(placement: .topBarTrailing) { actions }
        }
        .task(id: threadId) { await code.open(threadId) }
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

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        sendError = nil
        Task {
            do { try await code.send(text, to: threadId) } catch {
                draft = text
                sendError = error.localizedDescription
            }
        }
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
            ApprovalCard(item: item, threadId: threadId)
        case "error":
            Label(item.text, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(.red)
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
        case "failed": Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.system(size: 13))
        case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.system(size: 13))
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

struct ApprovalCard: View {
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
