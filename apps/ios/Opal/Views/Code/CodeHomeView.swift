import SwiftUI

/// Opal Code's inbox: every thread, sorted into what needs you, what's working and what's done.
struct CodeHomeView: View {
    @Environment(CodeStore.self) private var code
    @Environment(Shell.self) private var shell
    @State private var showSettled = false

    var body: some View {
        Group {
            if !code.loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if code.machines.isEmpty {
                empty(
                    title: "Connect a machine",
                    text: "Opal Code runs Claude Code and Codex on your own computers. On the web, open Code → Machines → Connect a machine, then run the command it shows on that computer.",
                    systemImage: "desktopcomputer"
                )
            } else if code.threads.isEmpty {
                empty(title: "No threads yet", text: "Start a task and an agent works on it on your machine. You can follow along here.", systemImage: "chevron.left.forwardslash.chevron.right")
            } else {
                inbox
            }
        }
        .topBar {
            ScreenHeader {
                Text("Code")
                    .font(.system(size: 16, weight: .semibold))
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .opalGlass(in: Capsule())
            } trailing: {
                GlassIconButton("arrow.clockwise", accessibility: "Refresh") { Task { await code.load() } }
                    .opacity(code.loaded ? 1 : 0)
            }
        }
        .bottomBar {
            if !code.machines.isEmpty {
                Button { shell.path.append(.newCodeThread) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                        Text("Start a coding task").font(.system(size: 17))
                        Spacer()
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .contentShape(Capsule())
                    .opalGlass(in: Capsule(), interactive: true)
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var inbox: some View {
        List {
            machinesStrip
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            ForEach(CodeThread.Section.allCases.filter { $0 != .settled }, id: \.self) { section in
                let list = code.threads.filter { $0.section == section }
                if !list.isEmpty {
                    Section {
                        ForEach(list) { row($0) }
                    } header: {
                        sectionHeader(section.title, count: list.count, tint: section == .needs ? .orange : .secondary)
                    }
                }
            }
            let settled = code.threads.filter { $0.section == .settled }
            if !settled.isEmpty {
                Section {
                    if showSettled { ForEach(settled) { row($0) } }
                } header: {
                    Button { withAnimation(Motion.morph) { showSettled.toggle() } } label: {
                        HStack(spacing: 6) {
                            sectionHeader("Settled", count: settled.count, tint: .secondary)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .rotationEffect(.degrees(showSettled ? 90 : 0))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await code.load() }
    }

    private var machinesStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(code.machines) { m in
                    HStack(spacing: 7) {
                        Circle()
                            .fill(m.online ? Color.green : Color.secondary.opacity(0.5))
                            .frame(width: 7, height: 7)
                        Text(m.name).font(.system(size: 14, weight: .medium))
                        if m.online && m.agents.contains(where: { $0.signedIn == false && ($0.id == "claude" || $0.id == "codex") }) {
                            Image(systemName: "person.crop.circle.badge.exclamationmark")
                                .font(.system(size: 12))
                                .foregroundStyle(.orange)
                                .accessibilityLabel("An agent needs signing in")
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Color.wash, in: Capsule())
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(m.name), \(m.online ? "online" : "offline")")
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func sectionHeader(_ title: String, count: Int, tint: Color) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
            Text("\(count)").font(.system(size: 13).monospacedDigit()).foregroundStyle(.tertiary)
        }
        .textCase(nil)
    }

    private func row(_ t: CodeThread) -> some View {
        Button { shell.path.append(.codeThread(t.id)) } label: {
            CodeThreadRow(thread: t, project: code.project(t.projectId))
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .swipeActions(edge: .leading) {
            Button { Task { await code.patch(t.id, ["pinned": .bool(t.pinnedAt == nil)]) } } label: {
                Label(t.pinnedAt == nil ? "Pin" : "Unpin", systemImage: t.pinnedAt == nil ? "pin" : "pin.slash")
            }
            .tint(.orange)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { Task { await code.delete(t.id) } } label: { Label("Delete", systemImage: "trash") }
            Button { Task { await code.patch(t.id, ["settled": .bool(t.settledAt == nil)]) } } label: {
                Label(t.settledAt == nil ? "Settle" : "Unsettle", systemImage: "checkmark.circle")
            }
            .tint(.green)
        }
    }

    private func empty(title: String, text: String, systemImage: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(.secondary)
                .frame(width: 72, height: 72)
                .opalGlass(in: Circle())
            Text(title).font(.system(size: 20, weight: .semibold))
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct CodeThreadRow: View {
    let thread: CodeThread
    let project: CodeProject?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AgentGlyph(agent: thread.agent, size: 16)
                .frame(width: 34, height: 34)
                .background(Color.wash, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(thread.title.isEmpty ? "New thread" : thread.title)
                        .font(.system(size: 16, weight: thread.unread ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(thread.lastActivityAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
                        .font(.system(size: 13))
                        .foregroundStyle(.tertiary)
                }
                if let preview = thread.preview, !preview.isEmpty {
                    Text(preview)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 6) {
                    status
                    Text([project?.name, thread.branch].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 12)
        .contentShape(.rect)
    }

    @ViewBuilder private var status: some View {
        switch thread.status {
        case "working":
            HStack(spacing: 4) {
                WorkingMark(size: 10)
                Text("Working").font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(Color.accentColor)
        case "waiting":
            Label("Needs you", systemImage: "hand.raised.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.orange)
                .labelStyle(.titleAndIcon)
        case "error":
            Label("Failed", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.red)
        default:
            if thread.unread {
                Circle().fill(Color.accentColor).frame(width: 7, height: 7).accessibilityLabel("Unread")
            }
        }
    }
}

/// A small mark for a coding agent: a burst for Claude Code, a terminal knot for Codex.
struct AgentGlyph: View {
    let agent: String
    var size: CGFloat = 16

    var body: some View {
        Group {
            if agent == "codex" {
                Image(systemName: "hexagon")
                    .font(.system(size: size * 0.95, weight: .medium))
                    .overlay { Image(systemName: "chevron.left.forwardslash.chevron.right").font(.system(size: size * 0.38, weight: .bold)) }
                    .foregroundStyle(.primary)
            } else {
                Canvas { ctx, s in
                    let c = CGPoint(x: s.width / 2, y: s.height / 2)
                    let k = s.width / 24
                    for i in 0..<8 {
                        let a = Double(i) * .pi / 4
                        let outer = (i % 2 == 0 ? 10 : 8.2) * k
                        var p = Path()
                        p.move(to: CGPoint(x: c.x + cos(a) * 2.6 * k, y: c.y + sin(a) * 2.6 * k))
                        p.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer))
                        ctx.stroke(p, with: .color(Color(hex: "#d97757")), style: StrokeStyle(lineWidth: 2.6 * k, lineCap: .round))
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(CodeAgents.label(agent))
    }
}
