import SwiftUI

/// The Agents tab: every agent you've made, newest activity first. Each has its own computer and
/// one ongoing thread; tapping one opens that thread.
struct AgentsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @State private var editing: AgentEdit?
    @State private var deleting: Agent?

    var body: some View {
        ScrollView {
            Group {
                if !shell.agentsLoaded {
                    skeleton
                } else if shell.agents.isEmpty {
                    empty
                } else {
                    VStack(spacing: 2) {
                        ForEach(shell.agents) { a in
                            row(a)
                                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.top, 6)
                }
            }
            .animation(Motion.morph, value: shell.agents)
        }
        .refreshable { await shell.loadAgents(session) }
        .topBar {
            ScreenHeader {
                HeaderTitle(text: "Agents")
            } trailing: {
                GlassIconButton("plus", accessibility: "New agent") { editing = AgentEdit(agent: nil) }
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        // Agents work on their own; keep "Working" and the previews current while this is open.
        .task {
            while !Task.isCancelled {
                await shell.loadAgents(session)
                try? await Task.sleep(for: .seconds(6))
            }
        }
        .sheet(item: $editing) { e in
            AgentEditorSheet(agent: e.agent)
        }
        .confirmationDialog(
            deleting.map { "Delete \($0.name)?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { a in
            Button("Delete agent", role: .destructive) { Task { await delete(a) } }
        } message: { _ in
            Text("Its thread, computer and files are deleted too. This can't be undone.")
        }
    }

    private func row(_ a: Agent) -> some View {
        Button {
            shell.openAgent(id: a.id, threadId: a.threadId)
        } label: {
            HStack(spacing: 13) {
                AgentFace(shape: a.shape, color: a.color, size: 44, working: a.running == true, seed: a.name)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(a.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 8)
                        if let at = a.activityAt {
                            Text(at.shortRelative).font(.system(size: 12.5).monospacedDigit()).foregroundStyle(.tertiary)
                        }
                    }
                    Group {
                        if a.running == true {
                            ShimmerText(text: "Working")
                        } else {
                            Text(a.preview?.isEmpty == false ? a.preview! : "No messages yet").foregroundStyle(.secondary)
                        }
                    }
                    .font(.system(size: 14))
                    .lineLimit(1)
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .contentShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(MenuRowStyle())
        .contextMenu {
            Button { editing = AgentEdit(agent: a) } label: { Label("Agent settings", systemImage: "slider.horizontal.3") }
            Button(role: .destructive) { deleting = a } label: { Label("Delete agent", systemImage: "trash") }
        }
    }

    private var skeleton: some View {
        VStack(spacing: 14) {
            ForEach(0..<3, id: \.self) { _ in
                HStack(spacing: 13) {
                    Circle().fill(Color.wash).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 7) {
                        Capsule().fill(Color.wash).frame(width: 96, height: 12)
                        Capsule().fill(Color.wash).frame(width: 170, height: 10)
                    }
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .transition(.opacity)
    }

    private var empty: some View {
        VStack(spacing: 16) {
            HStack(alignment: .bottom, spacing: 8) {
                AgentFace(shape: "ghost", color: "#3b82f6", size: 44, seed: "a")
                AgentFace(shape: "cookie", color: "#ea6a2a", size: 60, seed: "b")
                AgentFace(shape: "triangle", color: "#22a35a", size: 44, seed: "c")
            }
            VStack(spacing: 6) {
                Text("Make your first agent").font(.system(size: 20, weight: .semibold))
                Text("No agents yet. Each one gets its own computer and every tool, and keeps one ongoing thread.")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            AccentButton(title: "New agent", systemImage: "plus") { editing = AgentEdit(agent: nil) }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: 420)
        .containerRelativeFrame(.vertical) { h, _ in h * 0.8 }
        .frame(maxWidth: .infinity)
        .transition(.opacity)
    }

    private func delete(_ a: Agent) async {
        shell.removeAgent(a.id)
        _ = try? await session.api.sendRaw("/api/agents/\(a.id)", method: "DELETE")
    }
}

/// Which agent the editor is for (nil: a new one).
struct AgentEdit: Identifiable {
    let agent: Agent?
    var id: String { agent?.id ?? "new" }
}

/// A filled button in the accent: the one main action on an empty screen or a sheet.
struct AccentButton: View {
    let title: String
    var systemImage: String?
    var disabled = false
    var pending = false
    let action: () -> Void
    @Environment(\.accent) private var accent

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if pending {
                    ProgressView().tint(accent.fg)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 15, weight: .semibold))
                }
                Text(title).font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(accent.fg)
            .padding(.horizontal, 20)
            .frame(height: 46)
            .background(accent.fill, in: Capsule())
            .opacity(disabled ? 0.45 : 1)
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.96))
        .disabled(disabled || pending)
        .animation(Motion.quick, value: disabled)
    }
}

// MARK: Editor

/// Create or edit an agent: a name, a shape and a colour. That's all an agent is.
struct AgentEditorSheet: View {
    let agent: Agent?
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var color: String
    @State private var shape: String
    @State private var pending = false
    @State private var error: String?
    @State private var confirmDelete = false
    @FocusState private var nameFocused: Bool

    init(agent: Agent?) {
        self.agent = agent
        _name = State(initialValue: agent?.name ?? "")
        _color = State(initialValue: agent?.color ?? AgentShape.colors[1].value)
        _shape = State(initialValue: agent?.shape ?? AgentShape.all.randomElement()!.id)
    }

    private var valid: Bool { name.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    AgentFace(shape: shape, color: color, size: 88, seed: name.isEmpty ? "new" : name)
                        .id(shape)
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                        .animation(Motion.pop, value: shape)
                        .animation(.easeOut(duration: 0.2), value: color)

                    VStack(alignment: .leading, spacing: 8) {
                        FieldLabel("Name")
                        TextField("Scout", text: $name)
                            .font(.system(size: 17))
                            .focused($nameFocused)
                            .submitLabel(.done)
                            .onSubmit { Task { await save() } }
                            .onChange(of: name) { _, v in if v.count > 24 { name = String(v.prefix(24)) } }
                            .padding(.horizontal, 14)
                            .frame(height: 48)
                            .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        FieldLabel("Shape")
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
                            ForEach(AgentShape.all, id: \.id) { s in
                                Button { shape = s.id } label: {
                                    AgentFace(shape: s.id, color: color, size: 30, blink: false)
                                        .frame(maxWidth: .infinity)
                                        .aspectRatio(1, contentMode: .fit)
                                        .background(shape == s.id ? Color.wash : .clear, in: .rect(cornerRadius: 12, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                                .strokeBorder(Color.primary.opacity(shape == s.id ? 0.8 : 0), lineWidth: 2)
                                        }
                                        .contentShape(.rect)
                                }
                                .buttonStyle(PressableStyle(scale: 0.92))
                                .accessibilityLabel(s.label)
                                .accessibilityAddTraits(shape == s.id ? .isSelected : [])
                                .animation(Motion.quick, value: shape == s.id)
                            }
                        }
                    }
                    .sensoryFeedback(.selection, trigger: shape)

                    VStack(alignment: .leading, spacing: 8) {
                        FieldLabel("Color")
                        HStack(spacing: 10) {
                            ForEach(AgentShape.colors, id: \.id) { c in
                                Button { color = c.value } label: {
                                    Circle()
                                        .fill(Color(hex: c.value))
                                        .frame(width: 30, height: 30)
                                        .padding(3)
                                        .overlay { Circle().strokeBorder(Color.primary.opacity(color == c.value ? 0.9 : 0), lineWidth: 2) }
                                        .contentShape(Circle())
                                }
                                .buttonStyle(PressableStyle(scale: 0.9))
                                .accessibilityLabel(c.id)
                                .accessibilityAddTraits(color == c.value ? .isSelected : [])
                                .animation(Motion.quick, value: color == c.value)
                            }
                        }
                    }
                    .sensoryFeedback(.selection, trigger: color)

                    if let error {
                        Text(error).font(.system(size: 14)).foregroundStyle(Color.danger)
                    }

                    if agent != nil {
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label("Delete agent", systemImage: "trash")
                                .font(.system(size: 16))
                                .foregroundStyle(Color.danger)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .background(Color.danger.opacity(0.1), in: Capsule())
                        }
                        .buttonStyle(PressableStyle(scale: 0.97))
                        .padding(.top, 8)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(agent == nil ? "New agent" : "Agent settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if pending {
                        ProgressView()
                    } else {
                        Button(agent == nil ? "Create" : "Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(!valid)
                    }
                }
            }
            .confirmationDialog("Delete \(agent?.name ?? "agent")?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete agent", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Its thread, computer and files are deleted too. This can't be undone.")
            }
        }
        .presentationDetents([.large])
        .onAppear { if agent == nil { nameFocused = true } }
    }

    private func save() async {
        guard valid, !pending else { return }
        pending = true
        error = nil
        defer { pending = false }
        struct Body: Encodable { let name: String; let color: String; let shape: String }
        struct Res: Decodable { let agent: Agent }
        let body = Body(name: name.trimmingCharacters(in: .whitespaces), color: color, shape: shape)
        do {
            if let agent {
                var saved = try await session.api.send("/api/agents/\(agent.id)", method: "PATCH", json: body, as: Res.self).agent
                saved.threadId = saved.threadId ?? agent.threadId
                saved.preview = saved.preview ?? agent.preview
                saved.activityAt = saved.activityAt ?? agent.activityAt
                shell.upsert(saved)
                dismiss()
            } else {
                let created = try await session.api.send("/api/agents", method: "POST", json: body, as: Res.self).agent
                shell.upsert(created)
                dismiss()
                shell.openAgent(id: created.id, threadId: nil)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete() async {
        guard let agent else { return }
        do {
            _ = try await session.api.sendRaw("/api/agents/\(agent.id)", method: "DELETE")
            shell.removeAgent(agent.id)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A small label over a field or group.
struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: 14, weight: .medium)).foregroundStyle(.secondary)
    }
}

// MARK: Details

/// Who the agent is, its computer and what it has done (the web's details panel).
struct AgentDetailsSheet: View {
    let agent: Agent
    let model: ChatModel
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var showComputer = false
    @State private var remote: ComputerSheet.Remote?

    private var frame: SandboxFrame? { model.sandboxes.first { $0.agentId == agent.id } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 10) {
                        AgentFace(shape: agent.shape, color: agent.color, size: 72, working: model.busy, seed: agent.name)
                        VStack(spacing: 2) {
                            Text(agent.name).font(.system(size: 18, weight: .semibold))
                            Group {
                                if model.busy { ShimmerText(text: "Working") } else { Text("Ready").foregroundStyle(.secondary) }
                            }
                            .font(.system(size: 14))
                        }
                        HStack(spacing: 8) {
                            SmallButton(title: "Settings", systemImage: "slider.horizontal.3") { editing = true }
                            SmallButton(title: "Computer", systemImage: "display") { showComputer = true }
                        }
                        .padding(.top, 4)
                    }
                    .padding(.bottom, 20)

                    DetailSection(title: "Computer") { preview }
                    DetailSection(title: "Activity") { activity }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .sheet(isPresented: $editing) { AgentEditorSheet(agent: agent) }
        .sheet(isPresented: $showComputer) {
            ComputerSheet(frames: model.sandboxes, agentId: agent.id)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .task {
            struct Res: Decodable { let sandbox: ComputerSheet.Remote? }
            while !Task.isCancelled {
                if let r = try? await session.api.send("/api/sandbox/\(agent.id)", as: Res.self) { remote = r.sandbox }
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    private var preview: some View {
        let shot = frame?.screenshot ?? remote?.lastScreenshot
        let url = frame?.url ?? remote?.lastUrl
        return Button { showComputer = true } label: {
            ZStack(alignment: .bottom) {
                Color(hex: "#101010")
                if let shot {
                    AuthedImage(path: shot)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .clipped()
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "display").font(.system(size: 22, weight: .light))
                        Text(remote?.status == "running" ? "Nothing on screen yet" : remote != nil ? "Asleep" : "Not started yet")
                            .font(.system(size: 13))
                    }
                    .foregroundStyle(Color(hex: "#9a9a9a"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if url != nil || frame != nil {
                    HStack(spacing: 6) {
                        if frame != nil { Circle().fill(Color(hex: "#4ade80")).frame(width: 6, height: 6) }
                        Text(url ?? "Live").lineLimit(1).truncationMode(.middle)
                    }
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.black.opacity(0.6), in: .rect(cornerRadius: 8, style: .continuous))
                    .padding(8)
                }
            }
            .aspectRatio(16 / 10, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.primary.opacity(0.08)) }
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityLabel("Open \(agent.name)'s computer")
    }

    private struct Activity: Identifiable {
        let id: String
        let icon: String
        let label: String
        let state: String
    }

    private var items: [Activity] {
        var out: [Activity] = []
        let streamingId = model.busy ? model.messages.last?.key : nil
        for m in model.messages where m.role == "assistant" {
            for p in m.parts {
                guard case .tool(let call) = p, !hiddenTools.contains(call.name) else { continue }
                let failed = call.failed || call.state == "output-denied" || call.output?["ok"]?.bool == false
                let done = call.state == "output-available" || m.key != streamingId
                let state = failed ? "error" : done ? "done" : "running"
                if agentTools.contains(call.name) {
                    let to = call.name == "study_helper" ? "Study AI" : (call.input?["to"]?.string ?? call.input?["name"]?.string ?? "an agent")
                    out.append(Activity(id: call.id, icon: "bubble.left", label: "Sent message to \(to)", state: state))
                } else {
                    let d = describeTool(call.name, call.input)
                    out.append(Activity(id: call.id, icon: d.icon, label: d.label, state: state))
                }
            }
        }
        return Array(out.reversed().prefix(80))
    }

    private var activity: some View {
        let list = items
        return Group {
            if list.isEmpty {
                Text("Tools \(agent.name) uses show up here.").font(.system(size: 14)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 0) {
                    ForEach(list) { a in
                        HStack(spacing: 10) {
                            Image(systemName: a.icon).font(.system(size: 14)).foregroundStyle(.secondary).frame(width: 20)
                            Group {
                                if a.state == "running" {
                                    ShimmerText(text: a.label)
                                } else {
                                    Text(a.label).foregroundStyle(a.state == "error" ? Color.danger : Color.primary.opacity(0.85))
                                }
                            }
                            .font(.system(size: 14))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Circle()
                                .fill(a.state == "running" ? Color.secondary : a.state == "error" ? Color.danger : Color.success)
                                .frame(width: 6, height: 6)
                        }
                        .frame(height: 34)
                    }
                }
            }
        }
    }
}

/// A titled group in a details sheet, with a hairline above.
struct DetailSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary).padding(.top, 6)
            content
        }
        .padding(.bottom, 14)
    }
}

/// A compact secondary button (Settings, Computer…).
struct SmallButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .medium)) }
                Text(title).font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(Color.wash, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
    }
}
