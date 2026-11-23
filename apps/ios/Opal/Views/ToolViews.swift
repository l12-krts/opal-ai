import SwiftUI

struct ToolPartView: View {
    let id: String
    let name: String
    let state: String
    let input: JSONValue?
    let output: JSONValue?
    let error: String?
    let approvalId: String?
    let model: ChatModel
    @Environment(SessionStore.self) private var session
    @State private var secret = ""
    @State private var open = false

    private static let hidden: Set<String> = ["spawn_agent", "delegate", "ask_agent", "study_helper", "message_agent", "list_agents", "list_secrets"]

    var body: some View {
        if state == "approval-requested", let approvalId {
            approval(approvalId)
        } else {
            switch name {
            case "create_quiz": QuizView(input: input)
            case "create_flashcards": FlashcardsView(input: input)
            case "request_secret": secretRequest
            case "ask_user": askUser
            default:
                if !Self.hidden.contains(name) || state == "output-error" { row }
            }
        }
    }

    private var row: some View {
        DisclosureGroup(isExpanded: $open) {
            Text((output ?? input)?.pretty ?? "").font(.caption.monospaced()).foregroundStyle(.secondary)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).foregroundStyle(.secondary)
                Text(label).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if state.hasPrefix("input") { ProgressView().controlSize(.mini) }
                if state == "output-error" { Image(systemName: "exclamationmark.triangle").foregroundStyle(.red) }
            }
        }
    }

    private var icon: String {
        switch name {
        case "browser": "safari"
        case "terminal": "terminal"
        case "read_webpage": "globe"
        case let n where n.hasPrefix("study"): "book"
        case let n where n.hasPrefix("COMPOSIO"): "app.connected.to.app.below.fill"
        default: "wrench.and.screwdriver"
        }
    }

    private var label: String {
        switch name {
        case "browser": input?["url"]?.string.map { "Opened \(URL(string: $0)?.host() ?? $0)" } ?? "Browser"
        case "terminal": "Ran \(input?["command"]?.string?.prefix(50) ?? "")"
        case "study_search": "Searched “\(input?["query"]?.string ?? "")”"
        default: name.replacingOccurrences(of: "_", with: " ")
        }
    }

    private func approval(_ approvalId: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Opal wants to run an action", systemImage: "hand.raised").font(.subheadline.weight(.medium))
            Text(input?.pretty ?? "").font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(12)
            HStack {
                Spacer()
                Button("Deny", role: .cancel) { model.respondToApproval(approvalId, approved: false) }.buttonStyle(.bordered)
                Button("Approve") { model.respondToApproval(approvalId, approved: true) }.buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
        }
        .padding(12)
        .background(.fill.quinary, in: .rect(cornerRadius: 12))
    }

    @ViewBuilder private var secretRequest: some View {
        if state == "output-available" {
            Label(output?["status"]?.string == "saved" ? "Saved to vault" : "Not provided", systemImage: "lock").font(.subheadline).foregroundStyle(.secondary)
        } else if state == "input-available" {
            VStack(alignment: .leading, spacing: 8) {
                Label("Opal needs a secret", systemImage: "lock").font(.subheadline.weight(.medium))
                if let reason = input?["reason"]?.string { Text(reason).font(.footnote).foregroundStyle(.secondary) }
                SecureField(input?["label"]?.string ?? "Secret", text: $secret)
                    .textContentType(.password)
                    .padding(10)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 8))
                Text("Saved encrypted in your vault. The AI never sees the value.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Spacer()
                    Button("Cancel") { model.answer(tool: "request_secret", toolCallId: id, output: ["status": .string("declined")]) }
                    Button("Save secret") { Task { await saveSecret() } }.buttonStyle(.borderedProminent).disabled(secret.isEmpty)
                }
                .controlSize(.small)
            }
            .padding(12)
            .background(.fill.quinary, in: .rect(cornerRadius: 12))
        }
    }

    private func saveSecret() async {
        struct Body: Encodable { let name: String; let label: String; let description: String; let value: String }
        let body = Body(name: input?["name"]?.string ?? "", label: input?["label"]?.string ?? "", description: input?["reason"]?.string ?? "", value: secret)
        do {
            _ = try await session.api.sendRaw("/api/secrets", json: body)
            secret = ""
            model.answer(tool: "request_secret", toolCallId: id, output: ["status": .string("saved")])
        } catch {}
    }

    @ViewBuilder private var askUser: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(input?["question"]?.string ?? "").font(.subheadline.weight(.medium))
            FlowRow(items: (input?["options"]?.array ?? []).compactMap(\.string)) { option in
                Button(option) { model.answer(tool: "ask_user", toolCallId: id, output: ["answer": .string(option)]) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(state == "output-available")
            }
        }
    }
}

/// Wraps buttons onto multiple lines.
struct FlowRow<Content: View>: View {
    let items: [String]
    let content: (String) -> Content
    var body: some View {
        ViewThatFits {
            HStack { ForEach(items, id: \.self, content: content) }
            VStack(alignment: .leading) { ForEach(items, id: \.self, content: content) }
        }
    }
}

struct QuizView: View {
    let input: JSONValue?
    @State private var index = 0
    @State private var picks: [Int: Int] = [:]

    var body: some View {
        let questions = input?["questions"]?.array ?? []
        if questions.isEmpty {
            ProgressView()
        } else {
            let q = questions[min(index, questions.count - 1)]
            let options = q["options"]?.array.compactMap(\.string) ?? []
            let correct = q["correctIndex"]?.int ?? 0
            let picked = picks[index]
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(input?["title"]?.string ?? "Quiz").font(.subheadline.weight(.medium))
                    Spacer()
                    Text("\(index + 1) / \(questions.count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                Text(q["question"]?.string ?? "")
                ForEach(Array(options.enumerated()), id: \.offset) { i, option in
                    Button {
                        guard picked == nil else { return }
                        withAnimation(.snappy) { picks[index] = i }
                        if i != correct { UINotificationFeedbackGenerator().notificationOccurred(.error) }
                    } label: {
                        HStack {
                            Text(option).multilineTextAlignment(.leading)
                            Spacer()
                            if picked != nil && i == correct { Image(systemName: "checkmark").foregroundStyle(.green) }
                            if picked == i && i != correct { Image(systemName: "xmark").foregroundStyle(.red) }
                        }
                        .padding(10)
                        .background(background(i: i, picked: picked, correct: correct), in: .rect(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    if picked == i, i != correct, let why = q["wrongExplanations"]?.array[safe: i]?.string, !why.isEmpty {
                        Text(why).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if picked != nil, let exp = q["explanation"]?.string {
                    Text(exp).font(.footnote).padding(10).background(.fill.quinary, in: .rect(cornerRadius: 10))
                }
                HStack {
                    Button("Back") { index -= 1 }.disabled(index == 0)
                    Spacer()
                    Button("Next") { index += 1 }.disabled(index >= questions.count - 1)
                }
                .controlSize(.small)
            }
            .padding(12)
            .background(.fill.quinary.opacity(0.5), in: .rect(cornerRadius: 12))
        }
    }

    private func background(i: Int, picked: Int?, correct: Int) -> some ShapeStyle {
        guard let picked else { return AnyShapeStyle(.fill.tertiary) }
        if i == correct { return AnyShapeStyle(Color.green.opacity(0.15)) }
        if i == picked { return AnyShapeStyle(Color.red.opacity(0.15)) }
        return AnyShapeStyle(.fill.quaternary)
    }
}

struct FlashcardsView: View {
    let input: JSONValue?
    @State private var index = 0
    @State private var flipped = false

    var body: some View {
        let cards = input?["cards"]?.array ?? []
        if cards.isEmpty {
            ProgressView()
        } else {
            let card = cards[min(index, cards.count - 1)]
            VStack(spacing: 10) {
                ZStack {
                    face(card["front"]?.string ?? "").opacity(flipped ? 0 : 1)
                    face(card["back"]?.string ?? "").opacity(flipped ? 1 : 0).rotation3DEffect(.degrees(180), axis: (0, 1, 0))
                }
                .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (0, 1, 0))
                .onTapGesture { withAnimation(.smooth(duration: 0.45)) { flipped.toggle() } }
                HStack {
                    Button { flipped = false; index = (index - 1 + cards.count) % cards.count } label: { Image(systemName: "chevron.left") }
                    Spacer()
                    Text("\(index + 1) / \(cards.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    Spacer()
                    Button { flipped = false; index = (index + 1) % cards.count } label: { Image(systemName: "chevron.right") }
                }
                .controlSize(.small)
            }
            .padding(12)
            .background(.fill.quinary.opacity(0.5), in: .rect(cornerRadius: 12))
        }
    }

    private func face(_ text: String) -> some View {
        Text(text)
            .font(.body)
            .multilineTextAlignment(.center)
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 160)
            .background(.background, in: .rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
