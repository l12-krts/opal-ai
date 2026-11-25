import SwiftUI

// Opal Code's settings: defaults for new threads, the machines that run the agents, and the
// projects on them. Same endpoints and words as apps/web/src/app/(app)/code/settings.

// MARK: General

struct CodeSettings: Codable, Equatable {
    var defaultAgent: String
    var defaultMode: String
    var worktreeByDefault: Bool
    var settleDays: Int

    static let fallback = CodeSettings(defaultAgent: "claude", defaultMode: "auto", worktreeByDefault: false, settleDays: 3)
}

struct CodeGeneralSettingsPage: View {
    @Environment(SessionStore.self) private var session
    @State private var settings = CodeSettings.fallback
    @State private var loaded = false
    /// The next change came from the server (or undoes a failed save): don't send it back.
    @State private var quiet = false
    @State private var toast: Toast?

    private static let settle: [(days: Int, label: String)] = [(1, "After 1 day"), (3, "After 3 days"), (7, "After a week"), (30, "After a month"), (0, "Never")]

    var body: some View {
        SettingsScroll {
            if loaded {
                SettingsGroup(title: "New threads") {
                    CardSection {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Agent").font(.system(size: 16))
                            Picker("Agent", selection: $settings.defaultAgent) {
                                ForEach(CodeAgents.all) { Text($0.label).tag($0.id) }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                    CardSection {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Approvals").font(.system(size: 16))
                            Picker("Approvals", selection: $settings.defaultMode) {
                                Text("Auto").tag("auto")
                                Text("Ask").tag("ask")
                                Text("Full access").tag("full")
                            }
                            .pickerStyle(.segmented)
                            Text("Auto: safe steps run on their own and risky ones wait for you. Ask: everything waits. Full access: nothing waits.")
                                .font(.system(size: 13)).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    SettingsRow(label: "New worktree", info: "Start threads in Git projects on their own branch and folder.") {
                        Toggle("New worktree", isOn: $settings.worktreeByDefault).labelsHidden()
                    }
                }

                SettingsGroup(title: "Inbox", info: "A finished thread you've read moves out of the Inbox after this long. Threads with a merged pull request settle right away.") {
                    SettingsRow(label: "Settle finished threads") {
                        Picker("Settle finished threads", selection: $settings.settleDays) {
                            ForEach(Self.settle, id: \.days) { Text($0.label).tag($0.days) }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .tint(.secondary)
                    }
                }
            } else {
                SettingsGroup(title: "New threads") { SkeletonRows(count: 3) }
            }
        }
        .animation(Motion.morph, value: loaded)
        .toast($toast)
        .onChange(of: settings) { old, new in
            if quiet { quiet = false; return }
            guard loaded else { return }
            Task { await save(new, previous: old) }
        }
        .task {
            struct Res: Decodable { let settings: CodeSettings }
            let s = (try? await session.api.send("/api/code/settings", as: Res.self).settings) ?? .fallback
            if s != settings { quiet = true }
            settings = s
            loaded = true
        }
    }

    private func save(_ next: CodeSettings, previous: CodeSettings) async {
        do {
            _ = try await session.api.sendRaw("/api/code/settings", method: "PATCH", json: next)
        } catch {
            quiet = true
            settings = previous
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }
}

// MARK: Machines

struct CodeMachinesSettingsPage: View {
    @Environment(SessionStore.self) private var session
    @Environment(CodeStore.self) private var code
    @State private var pairing = false
    @State private var editing: CodeMachine?
    @State private var removing: CodeMachine?
    @State private var toast: Toast?

    var body: some View {
        SettingsScroll(info: "Computers that run your coding agents. Each one runs the Opal runner, which connects out to Opal, so it works behind a router or over Tailscale.") {
            AccentButton(title: "Connect a machine", systemImage: "plus") { pairing = true }

            SettingsGroup {
                if !code.loaded {
                    SkeletonRows()
                } else if code.machines.isEmpty {
                    EmptyRow("No machines yet")
                }
                ForEach(code.machines) { m in
                    MachineRow(machine: m) { editing = m } onRemove: { removing = m }
                        .transition(.opacity)
                }
            }
            .animation(Motion.morph, value: code.machines)
        }
        .toast($toast)
        .refreshable { await code.load() }
        .sheet(isPresented: $pairing) {
            PairSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $editing) { m in
            MachineEditSheet(machine: m) { toast = Toast(text: "Saved") }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(removing.map { "Remove \($0.name)?" } ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { m in
            Button("Remove", role: .destructive) {
                Task {
                    do {
                        _ = try await session.api.sendRaw("/api/code/machines/\(m.id)", method: "DELETE")
                        await code.load()
                    } catch {
                        toast = Toast(text: error.localizedDescription, error: true)
                    }
                }
            }
        } message: { _ in
            Text("Its projects and threads are removed from Opal and the runner is signed out. Nothing on the machine is deleted.")
        }
    }
}

private struct MachineRow: View {
    let machine: CodeMachine
    let onEdit: () -> Void
    let onRemove: () -> Void

    private var seen: String {
        if machine.online { return "Online" }
        guard let at = machine.lastSeenAt else { return "Never connected" }
        return "Seen \(at.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated)))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 13) {
                Image(systemName: "server.rack")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .background(Color.wash, in: .rect(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(machine.name).font(.system(size: 16, weight: .medium)).lineLimit(1)
                        HStack(spacing: 5) {
                            Circle().fill(machine.online ? Color.success : Color.secondary.opacity(0.6)).frame(width: 6, height: 6)
                            Text(seen).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    if let root = machine.projectsRoot {
                        Text(root)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Menu {
                    Button(action: onEdit) { Label("Rename or change folder", systemImage: "pencil") }
                    Divider()
                    Button(role: .destructive, action: onRemove) { Label("Remove", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Machine options")
            }
            if !machine.agents.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(machine.agents, id: \.id) { a in
                        Badge(text: CodeAgents.label(a.id) + (a.version.map { " \($0)" } ?? (a.ok ? "" : " · not set up")), warning: !a.ok)
                    }
                }
                .padding(.leading, 45)
                let notes = machine.agents.filter { !$0.ok && $0.note != nil }
                if !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(notes, id: \.id) { a in
                            Text(a.note ?? "").font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading, 45)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .top) { RowDivider() }
    }
}

private struct MachineEditSheet: View {
    let machine: CodeMachine
    let onSaved: () -> Void
    @Environment(SessionStore.self) private var session
    @Environment(CodeStore.self) private var code
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var root = ""
    @State private var pending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                FormField(label: "Name", text: $name, placeholder: machine.hostname, limit: 60)
                FormField(label: "Projects folder", text: $root, placeholder: "~/Projects", mono: true, limit: 500)
                if let error { ErrorNote(text: error) }
                Spacer()
            }
            .padding(20)
            .navigationTitle("Rename or change folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if pending { ProgressView() } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || root.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
        .onAppear {
            name = machine.name
            root = machine.projectsRoot ?? ""
        }
    }

    private func save() async {
        pending = true
        defer { pending = false }
        struct Body: Encodable { let name: String; let projectsRoot: String }
        do {
            _ = try await session.api.sendRaw("/api/code/machines/\(machine.id)", method: "PATCH", json: Body(name: name.trimmingCharacters(in: .whitespaces), projectsRoot: root.trimmingCharacters(in: .whitespaces)))
            await code.load()
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A one-time code and the command to run on the machine. Shows "Connected" once it pairs.
private struct PairSheet: View {
    @Environment(SessionStore.self) private var session
    @Environment(CodeStore.self) private var code
    @Environment(\.dismiss) private var dismiss

    struct Pairing: Decodable {
        struct Origin: Decodable, Hashable { let origin: String; let label: String }
        let code: String
        let origins: [Origin]
        let appImage: [String]
    }

    enum How: String, CaseIterable, Identifiable { case linux, source; var id: String { rawValue } }

    @State private var pairing: Pairing?
    @State private var error: String?
    @State private var how: How = .linux
    @State private var pick = 0
    @State private var startCount: Int?

    private var paired: Bool { startCount.map { code.machines.count > $0 } ?? false }
    private var origin: String { pairing?.origins[safe: pick]?.origin ?? session.api.base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("How to install", selection: $how) {
                        Text("Linux (AppImage)").tag(How.linux)
                        Text("From source").tag(How.source)
                    }
                    .pickerStyle(.segmented)

                    if let p = pairing, p.origins.count > 1 {
                        VStack(alignment: .leading, spacing: 7) {
                            FieldLabel("Opal's address from that machine")
                            Menu {
                                ForEach(Array(p.origins.enumerated()), id: \.offset) { i, o in
                                    Button {
                                        pick = i
                                    } label: {
                                        if i == pick { Label("\(o.origin) (\(o.label))", systemImage: "checkmark") } else { Text("\(o.origin) (\(o.label))") }
                                    }
                                }
                            } label: {
                                HStack(spacing: 8) {
                                    Text(p.origins[safe: pick]?.origin ?? "")
                                        .font(.system(size: 14, design: .monospaced))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Text(p.origins[safe: pick]?.label ?? "")
                                        .font(.system(size: 13))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .layoutPriority(1)
                                    Spacer(minLength: 4)
                                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                                }
                                .foregroundStyle(.primary)
                                .padding(.horizontal, 14)
                                .frame(height: 44)
                                .background(Color.wash, in: .rect(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }

                    if how == .linux {
                        Text("Run this on the Linux machine (64-bit Intel or ARM, such as a Raspberry Pi or an Umbrel VM). It installs the runner with Claude Code built in, connects it, and starts it as a service.")
                            .font(.system(size: 15)).foregroundStyle(.secondary)
                        if let p = pairing {
                            if p.appImage.isEmpty {
                                Text("The AppImage hasn't been built on this server. Run npm run appimage in apps/runner, or install from source.")
                                    .font(.system(size: 14)).foregroundStyle(Color.warning)
                            } else {
                                CopyBlock(text: "curl -fsSL '\(origin)/api/code/runner/install?code=\(p.code)' | sh")
                            }
                        } else if let error {
                            ErrorNote(text: error)
                        } else {
                            SkeletonBlock(height: 44, radius: 12)
                        }
                        Text("The machine needs Git for projects. If Claude Code isn't signed in there yet, a Sign in button shows up on the machine once it connects.")
                            .font(.system(size: 13)).foregroundStyle(.tertiary)
                    } else {
                        Text("The machine needs Node 22+, Git, and Claude Code or Codex. Run this in the opal-ai repo on that machine:")
                            .font(.system(size: 15)).foregroundStyle(.secondary)
                        CopyBlock(text: "cd apps/runner && npm install")
                        if let p = pairing {
                            CopyBlock(text: "npm run pair -- \(origin) \(p.code) --root ~/Projects")
                        } else if let error {
                            ErrorNote(text: error)
                        } else {
                            SkeletonBlock(height: 44, radius: 12)
                        }
                        CopyBlock(text: "npm start")
                    }

                    Text("The code works once and expires in 15 minutes. New projects go in ~/Projects; change it any time.")
                        .font(.system(size: 13)).foregroundStyle(.tertiary)

                    if paired {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color.success)
                            .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                }
                .padding(20)
                .animation(Motion.morph, value: how)
                .animation(Motion.pop, value: paired)
            }
            .navigationTitle("Connect a machine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(paired ? "Done" : "Close") { dismiss() }.fontWeight(paired ? .semibold : .regular)
                }
            }
            .sensoryFeedback(.success, trigger: paired) { _, new in new }
        }
        .task {
            startCount = code.machines.count
            do {
                let p = try await session.api.send("/api/code/machines", method: "POST", as: Pairing.self)
                withAnimation(Motion.morph) {
                    pairing = p
                    if p.appImage.isEmpty { how = .source }
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// A command in a box with a copy button.
struct CopyBlock: View {
    let text: String
    @State private var copied = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(text)
                .font(.system(size: 13, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                UIPasteboard.general.string = text
                copied = true
                Task {
                    try? await Task.sleep(for: .seconds(1.4))
                    copied = false
                }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .accessibilityLabel(copied ? "Copied" : "Copy")
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
        .background(Color.card, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.5) }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

// MARK: Projects

struct CodeProjectsSettingsPage: View {
    @Environment(SessionStore.self) private var session
    @Environment(CodeStore.self) private var code
    @Environment(Shell.self) private var shell
    @State private var creating = false
    @State private var removing: CodeProject?
    @State private var toast: Toast?

    var body: some View {
        SettingsScroll(info: "A project is a folder on one of your machines. New projects are created in that machine's projects folder.") {
            AccentButton(title: "New project", systemImage: "plus", disabled: code.machines.isEmpty) { creating = true }

            if !code.loaded {
                SettingsGroup { SkeletonRows() }
            } else if code.machines.isEmpty {
                SettingsGroup {
                    SettingsRow(label: "Connect a machine first.", labelColor: .secondary) {
                        Button("Machines") { shell.open(.settings(.codeMachines)) }
                            .font(.system(size: 15, weight: .medium))
                    }
                }
            }
            ForEach(code.machines) { m in
                let list = code.projects.filter { $0.machineId == m.id }
                SettingsGroup(title: m.name) {
                    if list.isEmpty { EmptyRow("No projects on this machine") }
                    ForEach(list) { p in
                        SettingsRow(label: p.name, sub: p.path, icon: AnyView(
                            Image(systemName: "folder").font(.system(size: 16)).foregroundStyle(.secondary)
                        ), mono: true) {
                            HStack(spacing: 2) {
                                if p.isGit {
                                    Image(systemName: "arrow.triangle.branch")
                                        .font(.system(size: 12))
                                        .foregroundStyle(.tertiary)
                                        .accessibilityLabel("Git repository")
                                }
                                Button { removing = p } label: {
                                    Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(.secondary).frame(width: 36, height: 36)
                                }
                                .buttonStyle(PressableStyle(scale: 0.9))
                                .accessibilityLabel("Remove from Opal")
                            }
                        }
                        .transition(.opacity)
                    }
                }
            }
        }
        .animation(Motion.morph, value: code.projects)
        .toast($toast)
        .refreshable { await code.load() }
        .sheet(isPresented: $creating) {
            NewProjectSheet { name in toast = Toast(text: "\(name) created") }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(removing.map { "Remove \($0.name)?" } ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { p in
            Button("Remove", role: .destructive) {
                Task {
                    _ = try? await session.api.sendRaw("/api/code/projects/\(p.id)", method: "DELETE")
                    await code.load()
                }
            }
        } message: { _ in
            Text("It's removed from Opal only. The folder stays on the machine.")
        }
    }
}

private struct NewProjectSheet: View {
    let onCreated: (String) -> Void
    @Environment(SessionStore.self) private var session
    @Environment(CodeStore.self) private var code
    @Environment(\.dismiss) private var dismiss
    @State private var machineId = ""
    @State private var name = ""
    @State private var existing = false
    @State private var path = ""
    @State private var git = true
    @State private var pending = false
    @State private var error: String?

    private var machine: CodeMachine? { code.machine(machineId) }
    private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }
    private var valid: Bool {
        !trimmed.isEmpty && trimmed.range(of: #"^[\w.-][\w .-]*$"#, options: .regularExpression) != nil && (!existing || !path.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if code.machines.count > 1 {
                        VStack(alignment: .leading, spacing: 7) {
                            FieldLabel("Machine")
                            Picker("Machine", selection: $machineId) {
                                ForEach(code.machines) { Text($0.name).tag($0.id) }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                    if let m = machine, !m.online {
                        Label("\(m.name) is offline.", systemImage: "exclamationmark.triangle")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.warning)
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FormField(label: "Name", text: $name, placeholder: "my-app", keyboard: .asciiCapable, limit: 60)
                        if !existing, let root = machine?.projectsRoot {
                            Text("\(root)/\(trimmed.isEmpty ? "my-app" : trimmed)")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                    VStack(spacing: 0) {
                        SettingsRow(label: "Use an existing folder") {
                            Toggle("Use an existing folder", isOn: $existing.animation(Motion.morph)).labelsHidden()
                        }
                        if existing {
                            CardSection {
                                FormField(label: "Folder", text: $path, placeholder: "~/Projects/my-app", mono: true, limit: 500)
                            }
                            .transition(.opacity)
                        } else {
                            SettingsRow(label: "Git repository") {
                                Toggle("Git repository", isOn: $git).labelsHidden()
                            }
                            .transition(.opacity)
                        }
                    }
                    .padding(.top, -1)
                    .background(Color.card, in: .rect(cornerRadius: 20, style: .continuous))
                    .clipShape(.rect(cornerRadius: 20, style: .continuous))
                    if let error { ErrorNote(text: error) }
                }
                .padding(20)
            }
            .navigationTitle("New project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if pending { ProgressView() } else {
                        Button("Create") { Task { await create() } }.fontWeight(.semibold).disabled(!valid)
                    }
                }
            }
        }
        .onAppear { if machineId.isEmpty { machineId = (code.machines.first { $0.online } ?? code.machines.first)?.id ?? "" } }
    }

    private func create() async {
        pending = true
        error = nil
        defer { pending = false }
        struct Body: Encodable { let machineId: String; let name: String; let git: Bool; let existingPath: String? }
        let folder = path.trimmingCharacters(in: .whitespaces)
        do {
            _ = try await session.api.sendRaw("/api/code/projects", json: Body(machineId: machineId, name: trimmed, git: git, existingPath: existing ? folder : nil))
            await code.load()
            onCreated(trimmed)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
