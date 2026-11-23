import SwiftUI

struct AgentsView: View {
    @Environment(SessionStore.self) private var session
    var onOpen: (Agent) -> Void
    @State private var agents: [Agent] = []
    @State private var loading = true

    var body: some View {
        List {
            if !loading && agents.isEmpty {
                ContentUnavailableView("No agents yet", systemImage: "person.2", description: Text("Create agents on the web for now. Each one has its own computer and one ongoing thread."))
            }
            ForEach(agents) { a in
                Button { onOpen(a) } label: {
                    HStack(spacing: 14) {
                        AgentFace(shape: a.shape, color: a.color, size: 44)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(a.name).font(.system(size: 17, weight: .semibold))
                            Text(a.running == true ? "Working" : (a.preview?.isEmpty == false ? a.preview! : "No messages yet"))
                                .font(.system(size: 14))
                                .foregroundStyle(a.running == true ? Color.accentColor : Color.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if a.running == true { WorkingMark(size: 12).foregroundStyle(Color.accentColor) }
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .topBar {
            ScreenHeader {
                Text("Agents")
                    .font(.system(size: 16, weight: .semibold))
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .opalGlass(in: Capsule())
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            struct Res: Decodable { let agents: [Agent] }
            defer { loading = false }
            agents = (try? await session.api.send("/api/agents", as: Res.self).agents) ?? []
        }
    }
}

/// The agent's face: its color in (roughly) its shape, with two eyes. The web draws every shape
/// exactly; here the common ones are approximated.
struct AgentFace: View {
    let shape: String?
    let color: String
    var size: CGFloat = 28

    var body: some View {
        body(for: shape ?? "circle")
            .frame(width: size, height: size)
            .overlay {
                HStack(spacing: size * 0.14) {
                    Capsule().fill(.white).frame(width: size * 0.1, height: size * 0.18)
                    Capsule().fill(.white).frame(width: size * 0.1, height: size * 0.18)
                }
                .offset(y: -size * 0.04)
            }
            .accessibilityHidden(true)
    }

    @ViewBuilder private func body(for shape: String) -> some View {
        let fill = Color(hex: color)
        switch shape {
        case "squircle": RoundedRectangle(cornerRadius: size * 0.34, style: .continuous).fill(fill)
        case "pill": Capsule().fill(fill).frame(height: size * 0.6)
        case "diamond": RoundedRectangle(cornerRadius: size * 0.16, style: .continuous).fill(fill).rotationEffect(.degrees(45)).scaleEffect(0.72)
        case "arch", "ghost": UnevenRoundedRectangle(topLeadingRadius: size / 2, bottomLeadingRadius: size * 0.14, bottomTrailingRadius: size * 0.14, topTrailingRadius: size / 2, style: .continuous).fill(fill)
        default: Circle().fill(fill)
        }
    }
}

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @State private var nerd = false

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    Text(String((session.userName ?? "?").prefix(1)).uppercased())
                        .font(.system(size: 20, weight: .semibold))
                        .frame(width: 52, height: 52)
                        .background(Color.wash, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.userName ?? "Signed in").font(.system(size: 17, weight: .semibold))
                        Text(Config.baseURL.host() ?? "").font(.system(size: 13)).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            Section("Account") {
                Button("Sign out", role: .destructive) { session.signOut() }
            }
            Section {
                Toggle("Nerd mode", isOn: $nerd)
                    .onChange(of: nerd) { _, v in
                        Task { _ = try? await session.api.sendRaw("/api/settings", method: "PATCH", json: ["nerdMode": v]) }
                    }
            } footer: {
                Text("Shows reasoning in full, raw tool calls, token counts and sandbox details.")
            }
        }
        .scrollContentBackground(.hidden)
        .topBar {
            ScreenHeader {
                Text("Settings")
                    .font(.system(size: 16, weight: .semibold))
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .opalGlass(in: Capsule())
            }
        }
        .background(Color.sidebar.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            struct Res: Decodable { struct S: Decodable { let nerdMode: Bool }; let settings: S }
            nerd = (try? await session.api.send("/api/settings", as: Res.self).settings.nerdMode) ?? false
        }
    }
}
