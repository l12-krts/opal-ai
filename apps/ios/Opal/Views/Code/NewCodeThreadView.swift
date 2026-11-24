import SwiftUI

/// Start a coding task: where it runs (a project, or anywhere on a machine), which agents, then
/// the task itself in the composer. Permissions live in the composer's "+" menu.
struct NewCodeThreadView: View {
    @Environment(CodeStore.self) private var code
    @Environment(Shell.self) private var shell
    @Environment(SessionStore.self) private var session
    @Environment(\.accent) private var accent
    @State private var target: Target?
    @State private var agents: [String] = ["claude"]
    @State private var models: [String: String] = [:]
    @State private var mode = "auto"
    @State private var worktree = false
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @State private var menuOpen = false
    @FocusState private var focused: Bool

    enum Target: Hashable { case project(String), machine(String) }

    private var machineId: String? {
        switch target {
        case .project(let id): code.project(id)?.machineId
        case .machine(let id): id
        case nil: nil
        }
    }

    private var project: CodeProject? {
        if case .project(let id) = target { return code.project(id) }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                where_
                agentsSection
                if let project, project.isGit, agents.count == 1 {
                    Toggle(isOn: $worktree) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Work on a new branch").font(.system(size: 16, weight: .medium))
                            Text("In its own worktree, so your checkout stays untouched").font(.system(size: 13)).foregroundStyle(.secondary)
                        }
                    }
                    .tint(accent.line)
                    .padding(14)
                    .background(Color.wash, in: .rect(cornerRadius: 18, style: .continuous))
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .animation(Motion.morph, value: agents)
            .animation(Motion.morph, value: target)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay { MenuScrim(open: $menuOpen) }
        .bottomBar {
            Composer(
                text: $text,
                placeholder: "Describe the task",
                busy: false,
                canSend: !sending && target != nil && !agents.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                chips: mode == "auto" ? [] : [ComposerChip(id: "mode", label: CodeAgents.modeLabel(mode), systemImage: mode == "full" ? "bolt" : "hand.raised", remove: { mode = "auto" })],
                menuOpen: $menuOpen,
                focus: $focused,
                onSend: start,
                onStop: {}
            ) {
                ModeMenu(mode: mode) { m in
                    withAnimation(Motion.morph) { mode = m }
                    withAnimation(Motion.dismiss) { menuOpen = false }
                }
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("New task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .onAppear(perform: pickDefault)
        // Opened before Code's state arrived (a cold start straight to New task): pick once it does.
        .onChange(of: code.machines.count) { _, _ in pickDefault() }
        .task { await loadDefaults() }
    }

    /// The defaults from Code → General (agent, approvals, new worktree).
    private func loadDefaults() async {
        struct Res: Decodable { let settings: CodeSettings }
        guard let s = try? await session.api.send("/api/code/settings", as: Res.self).settings else { return }
        withAnimation(Motion.morph) {
            if agents == ["claude"] { agents = [s.defaultAgent] }
            if mode == "auto" { mode = s.defaultMode }
            if !worktree { worktree = s.worktreeByDefault }
        }
    }

    // MARK: Where

    private var where_: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Where")
            VStack(spacing: 0) {
                ForEach(Array(code.machines.enumerated()), id: \.element.id) { mi, m in
                    if mi > 0 { Divider().padding(.leading, 14) }
                    targetRow(.machine(m.id), title: "Anywhere on \(m.name)", subtitle: m.online ? "Online" : "Offline", systemImage: "desktopcomputer", enabled: m.online)
                    ForEach(code.projects.filter { $0.machineId == m.id }) { p in
                        Divider().padding(.leading, 50)
                        targetRow(.project(p.id), title: p.name, subtitle: p.path, systemImage: p.isGit ? "arrow.triangle.branch" : "folder", enabled: m.online)
                    }
                }
            }
            .background(Color.wash, in: .rect(cornerRadius: 18, style: .continuous))
        }
    }

    private func targetRow(_ t: Target, title: String, subtitle: String, systemImage: String, enabled: Bool) -> some View {
        Button { target = t } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage).font(.system(size: 15)).foregroundStyle(.secondary).frame(width: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 16)).foregroundStyle(.primary).lineLimit(1)
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                if target == t {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 19))
                        .foregroundStyle(accent.line)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 54)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityAddTraits(target == t ? .isSelected : [])
    }

    // MARK: Agents

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Agents")
            HStack(spacing: 10) {
                ForEach(CodeAgents.all) { a in agentCard(a.id, label: a.label, models: a.models) }
            }
            if agents.count > 1 {
                Text("Each agent gets its own thread and branch, so you can compare.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
            }
            if let mid = machineId, let m = code.machine(mid) {
                ForEach(agents, id: \.self) { a in
                    if let info = m.agent(a), info.signedIn == false || !info.ok {
                        Label(
                            info.signedIn == false ? "\(CodeAgents.label(a)) isn't signed in on \(m.name). Sign in from Opal on the web: Code → Machines." : (info.note ?? "\(CodeAgents.label(a)) isn't ready on \(m.name)."),
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.system(size: 13))
                        .foregroundStyle(.orange)
                    }
                }
            }
        }
    }

    private func agentCard(_ id: String, label: String, models list: [CodeAgents.Option]) -> some View {
        let on = agents.contains(id)
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                if on { if agents.count > 1 { agents.removeAll { $0 == id } } } else { agents.append(id) }
            } label: {
                HStack(spacing: 8) {
                    AgentGlyph(agent: id, size: 18)
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(on ? accent.line : Color.secondary)
                        .contentTransition(.symbolEffect(.replace))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Menu {
                ForEach(list) { m in
                    Button {
                        models[id] = m.id
                    } label: {
                        if (models[id] ?? "default") == m.id { Label(m.label, systemImage: "checkmark") } else { Text(m.label) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(list.first { $0.id == (models[id] ?? "default") }?.label ?? "Default")
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
                }
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            }
            .disabled(!on)
            .opacity(on ? 1 : 0.5)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(on ? accent.line.opacity(0.1) : Color.wash, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(on ? accent.line.opacity(0.5) : .clear, lineWidth: 1)
        }
        .sensoryFeedback(.selection, trigger: on)
    }

    private func heading(_ s: String) -> some View {
        Text(s).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).padding(.leading, 4)
    }

    // MARK: Actions

    private func pickDefault() {
        guard target == nil else { return }
        let online = Set(code.machines.filter(\.online).map(\.id))
        if let recent = code.threads.first(where: { $0.projectId != nil && online.contains($0.machineId) })?.projectId {
            target = .project(recent)
        } else if let p = code.projects.first(where: { online.contains($0.machineId) }) {
            target = .project(p.id)
        } else if let m = code.machines.first(where: \.online) {
            target = .machine(m.id)
        }
    }

    private func start() {
        guard let target else { return }
        let task = text.trimmingCharacters(in: .whitespacesAndNewlines)
        sending = true
        error = nil
        Task {
            defer { sending = false }
            do {
                let pid: String? = { if case .project(let id) = target { return id } else { return nil } }()
                let ids = try await code.start(
                    projectId: pid,
                    machineId: machineId,
                    agents: agents.map { (agent: $0, model: models[$0]) },
                    mode: mode,
                    // Only Git projects can branch off; several agents each get their own anyway.
                    worktree: worktree && project?.isGit == true,
                    text: task
                )
                text = ""
                if let first = ids.first { shell.path = [.codeThread(first)] }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
