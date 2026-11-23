import SwiftUI

struct ChatScreen: View {
    @State var model: ChatModel
    var onActivity: () -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if model.messages.isEmpty {
                        VStack(spacing: 12) {
                            OpalMark(size: 32)
                            Text(model.studyMode ? "Ask about your course material" : "Ask Opal anything")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 120)
                    }
                    ForEach(model.messages) { m in
                        MessageRow(message: m, model: model)
                            .id(m.id)
                            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    if case .sending = model.status {
                        HStack(spacing: 8) {
                            OpalMark(size: 14).foregroundStyle(.secondary)
                            Text("Thinking").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    if case .failed(let msg) = model.status {
                        Text(msg).font(.footnote).foregroundStyle(.red)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.last?.parts.count) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: model.messages.last?.text) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(model.title.isEmpty ? "New chat" : model.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .onChange(of: model.busy) { _, busy in if !busy { onActivity() } }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(model.studyMode ? "Ask about your course material" : "Ask Opal", text: $draft, axis: .vertical)
                .lineLimit(1...8)
                .focused($focused)
                .onSubmit(send)
            HStack {
                Toggle(isOn: $model.studyMode) { Label("Study", systemImage: "book") }
                    .toggleStyle(.button)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                Spacer()
                Button {
                    if model.busy { model.stop() } else { send() }
                } label: {
                    Image(systemName: model.busy ? "stop.fill" : "arrow.up")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 30, height: 30)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
                .disabled(!model.busy && draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel(model.busy ? "Stop" : "Send")
            }
        }
        .padding(12)
        .background(.regularMaterial, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.separator, lineWidth: 0.5))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private func send() {
        let text = draft
        draft = ""
        model.send(text)
    }
}

struct MessageRow: View {
    let message: ChatMessage
    let model: ChatModel

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.fill.secondary, in: .rect(cornerRadius: 18))
                    .textSelection(.enabled)
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(message.parts) { part in
                    PartView(part: part, model: model)
                }
            }
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
            Text(markdown(text)).textSelection(.enabled)
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
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
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
