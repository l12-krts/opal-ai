import SwiftUI

/// Wordmark and search on top, the places (Code, Agents), chats grouped by day, and a bar at the
/// bottom with a new chat and your account. Matches the web sidebar, laid out for a thumb.
struct SidebarView: View {
    var width: CGFloat
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @Environment(CodeStore.self) private var code
    @Environment(\.accent) private var accent
    @State private var searching = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @State private var renaming: Conversation?
    @State private var renameText = ""
    @State private var deleting: Conversation?

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if !searching {
                        // Memory, skills and connectors live in Customization; study and
                        // handwriting in Settings (as on the web).
                        NavRow(title: "Code", systemImage: "chevron.left.forwardslash.chevron.right", badge: code.needsYouCount, active: shell.route == .code) {
                            shell.go(.code)
                        }
                        NavRow(title: "Agents", systemImage: "person.2", active: shell.route == .agents) {
                            shell.go(.agents)
                        }
                        NavRow(title: "Customization", systemImage: "sparkles", active: shell.route == .customization) {
                            shell.go(.customization)
                        }
                        NavRow(title: "Settings", systemImage: "gearshape", active: shell.route == .settings) {
                            shell.go(.settings)
                        }
                        Color.clear.frame(height: 14)
                    }
                    chats
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.immediately)
            .refreshable { await shell.loadChats(session) }
            footer
        }
        .frame(width: width)
        .background(Color.sidebar.ignoresSafeArea())
        .alert("Rename chat", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $renameText)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Save") {
                if let c = renaming { Task { await shell.rename(c, to: renameText, session) } }
                renaming = nil
            }
        }
        .confirmationDialog("Delete this chat?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let c = deleting { Task { await shell.delete(c, session) } }
                deleting = nil
            }
        } message: {
            Text("It's removed from all your devices.")
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            if searching {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search chats", text: $query)
                        .focused($searchFocused)
                        .submitLabel(.search)
                }
                .padding(.horizontal, 14)
                .frame(height: 44)
                .opalGlass(in: Capsule())
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .trailing)))
                GlassIconButton("xmark", accessibility: "Close search") {
                    withAnimation(Motion.morph) { searching = false; query = "" }
                }
            } else {
                Wordmark(height: 24)
                    .foregroundStyle(Color.ink)
                    .padding(.leading, 10)
                    .transition(.opacity)
                Spacer()
                GlassIconButton("magnifyingglass", accessibility: "Search chats") {
                    withAnimation(Motion.morph) { searching = true }
                    searchFocused = true
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }

    // MARK: Chats

    @ViewBuilder private var chats: some View {
        if shell.loadingChats && shell.conversations.isEmpty {
            ForEach(0..<6, id: \.self) { i in
                Text(String(repeating: "Loading chat ", count: 1 + i % 3))
                    .font(.system(size: 16))
                    .redacted(reason: .placeholder)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
        } else if filtered.isEmpty {
            Text(searching ? "No chats match" : "Your chats show up here")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 8)
        } else {
            ForEach(groups, id: \.title) { group in
                Text(group.title)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 14)
                    .padding(.bottom, 4)
                ForEach(group.items) { c in chatRow(c) }
            }
        }
    }

    private func chatRow(_ c: Conversation) -> some View {
        let active: Bool = { if case .chat(let id, _, _) = shell.route { return id == c.id } else { return false } }()
        return Button {
            shell.go(.chat(id: c.id, isNew: false, agentId: c.agentId))
        } label: {
            HStack(spacing: 8) {
                if c.mode == "study" {
                    Image(systemName: "book").font(.system(size: 13)).foregroundStyle(.secondary)
                }
                Text(c.title.isEmpty ? "New chat" : c.title)
                    .font(.system(size: 16))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(active ? Color.wash : .clear, in: .rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .contextMenu {
            Button { Task { await shell.setPinned(c, !c.pinned, session) } } label: {
                Label(c.pinned ? "Unpin" : "Pin", systemImage: c.pinned ? "pin.slash" : "pin")
            }
            Button {
                renameText = c.title
                renaming = c
            } label: { Label("Rename", systemImage: "pencil") }
            Button(role: .destructive) { deleting = c } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private var filtered: [Conversation] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return shell.conversations }
        return shell.conversations.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    private struct ChatGroup { let title: String; let items: [Conversation] }

    /// Pinned, Today, Yesterday, Previous 7 days, Older: the same buckets as the web.
    private var groups: [ChatGroup] {
        let cal = Calendar.current
        let now = Date.now
        var pinned: [Conversation] = [], today: [Conversation] = [], yesterday: [Conversation] = [], week: [Conversation] = [], older: [Conversation] = []
        for c in filtered {
            if c.pinned { pinned.append(c) }
            else if cal.isDateInToday(c.updatedAt) { today.append(c) }
            else if cal.isDateInYesterday(c.updatedAt) { yesterday.append(c) }
            else if let d = cal.dateComponents([.day], from: c.updatedAt, to: now).day, d < 7 { week.append(c) }
            else { older.append(c) }
        }
        return [ChatGroup(title: "Pinned", items: pinned), ChatGroup(title: "Today", items: today), ChatGroup(title: "Yesterday", items: yesterday), ChatGroup(title: "Previous 7 days", items: week), ChatGroup(title: "Older", items: older)]
            .filter { !$0.items.isEmpty }
    }

    // MARK: Footer

    private var footer: some View {
        GlassGroup {
            HStack(spacing: 12) {
                Button { shell.newChat() } label: {
                    Label("New chat", systemImage: "square.and.pencil")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(accent.fg)
                        .padding(.horizontal, 20)
                        .frame(height: 50)
                        .background(accent.fill, in: Capsule())
                        .opalGlass(in: Capsule(), interactive: true, tint: accent.fill)
                }
                .buttonStyle(PressableStyle())
                Spacer()
                GlassIconButton(themeIcon, size: 50, accessibility: "Theme: \(session.theme.label)") {
                    let next: [ThemePreference: ThemePreference] = [.system: .light, .light: .dark, .dark: .system]
                    session.setTheme(next[session.theme] ?? .system)
                }
                .contentTransition(.symbolEffect(.replace))
                .sensoryFeedback(.selection, trigger: session.theme)
                Menu {
                    Section(session.userName ?? "") {
                        Button { shell.go(.settings) } label: { Label("Settings", systemImage: "gearshape") }
                        Button(role: .destructive) { session.signOut() } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
                    }
                } label: {
                    Text(initials)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 50, height: 50)
                        .opalGlass(in: Circle(), interactive: true)
                }
                .accessibilityLabel("Account")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }

    private var themeIcon: String {
        switch session.theme {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    private var initials: String {
        let parts = (session.userName ?? "").split(separator: " ").prefix(2)
        let s = parts.compactMap(\.first).map(String.init).joined()
        return s.isEmpty ? "·" : s.uppercased()
    }
}

/// A place in the sidebar: icon, title, and a count when something waits for you.
struct NavRow: View {
    let title: String
    let systemImage: String
    var badge: Int = 0
    var active = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .regular))
                    .frame(width: 26)
                Text(title).font(.system(size: 17, weight: .regular))
                Spacer(minLength: 0)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .frame(minWidth: 22, minHeight: 22)
                        .background(Color.orange, in: Capsule())
                        .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .frame(height: 46)
            .background(active ? Color.wash : .clear, in: .rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect(cornerRadius: 12))
            .animation(Motion.quick, value: badge)
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }
}
