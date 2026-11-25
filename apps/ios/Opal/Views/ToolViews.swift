import SwiftUI
import UIKit

// The tool calls that show as cards in an answer: approvals, quizzes, flashcards, secret requests,
// questions for the user, generated UI and handwriting. Everything else is a step (Parts.swift).

struct ToolPartView: View {
    let call: ToolCall
    let streaming: Bool
    let model: ChatModel
    @Environment(SessionStore.self) private var session

    var body: some View {
        if call.state == "approval-requested", call.approvalId != nil {
            ApprovalCard(call: call, model: model)
        } else {
            switch call.name {
            case "create_quiz": QuizView(call: call)
            case "create_flashcards": FlashcardsView(call: call)
            case "request_secret": SecretRequestView(call: call, model: model)
            case "ask_user": AskUserView(call: call, model: model)
            case "render_ui": GenUIView(call: call, model: model)
            case "write_by_hand": HandwritingArtifactView(call: call)
            case "remember", "forget": MemoryRow(call: call, forgot: call.name == "forget")
            case "share_file": SharedFileCard(call: call, streaming: streaming)
            // Docs, slides, sheets, charts and whiteboards (Views/Documents).
            case "create_doc", "create_slides", "create_sheet", "create_chart", "create_whiteboard", "update_document", "show_document":
                DocumentToolView(call: call)
            default: ToolRow(call: call, streaming: streaming, nerd: session.nerdMode)
            }
        }
    }
}

// MARK: Card chrome

extension View {
    /// A bordered card on the page colour, like the web's `rounded-card border bg-overlay`.
    func opalCard(radius: CGFloat = 16) -> some View {
        background(Color.canvas, in: .rect(cornerRadius: radius, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.primary.opacity(0.09)) }
    }
}

/// A grey block standing in for something that's still coming.
struct SkeletonBlock: View {
    var height: CGFloat
    var radius: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
            let dip = (1 - cos(t * 2 * .pi)) / 2
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Color.primary.opacity(reduceMotion ? 0.06 : 0.05 + 0.03 * dip))
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Loading")
    }
}

/// A small text button in the card footers.
struct CardButton: View {
    let title: String
    var systemImage: String?
    var style: Style = .ghost
    var disabled = false
    let action: () -> Void
    @Environment(\.accent) private var accent

    enum Style { case ghost, secondary, primary, accent }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 13)) }
                Text(title)
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(background, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    private var foreground: Color {
        switch style {
        case .ghost, .secondary: .primary
        case .primary: Color.canvas
        case .accent: accent.fg
        }
    }

    private var background: Color {
        switch style {
        case .ghost: .clear
        case .secondary: Color.wash
        case .primary: Color.ink
        case .accent: accent.fill
        }
    }
}

/// Lays its children out in rows, wrapping to the next row when one is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { y += line + lineSpacing; x = 0; line = 0 }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += line + lineSpacing; x = bounds.minX; line = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// Shakes sideways once each time `trigger` changes: a wrong answer.
private struct Shake: ViewModifier {
    let trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content.keyframeAnimator(initialValue: CGFloat(0), trigger: trigger) { view, x in
                view.offset(x: x)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(-5, duration: 0.05)
                    LinearKeyframe(5, duration: 0.06)
                    LinearKeyframe(-3, duration: 0.05)
                    LinearKeyframe(2, duration: 0.04)
                    SpringKeyframe(0, duration: 0.1)
                }
            }
        }
    }
}

// MARK: Quiz

/// A multiple-choice quiz. Every wrong option comes with its own explanation, written in advance,
/// so the feedback is instant and about that exact mistake.
struct QuizView: View {
    let call: ToolCall

    private struct Q {
        let question: String
        let options: [String]
        let correct: Int
        let explanation: String
        let wrong: [String]
    }

    private var questions: [Q] {
        (call.input?["questions"]?.array ?? []).compactMap { q in
            guard let text = q["question"]?.string else { return nil }
            let options = q["options"]?.array.compactMap(\.string) ?? []
            guard options.count >= 2 else { return nil }
            return Q(question: text, options: options, correct: q["correctIndex"]?.int ?? 0, explanation: q["explanation"]?.string ?? "", wrong: q["wrongExplanations"]?.array.map { $0.string ?? "" } ?? [])
        }
    }

    var body: some View {
        let qs = questions
        if call.state == "input-streaming" || qs.isEmpty {
            if call.state != "output-error" { SkeletonBlock(height: 190) }
        } else {
            Quiz(title: call.input?["title"]?.string ?? "Quiz", questions: qs)
        }
    }

    private struct Quiz: View {
        let title: String
        let questions: [Q]
        @State private var index = 0
        @State private var picks: [Int: Int] = [:]
        @State private var shakes: [Int: Int] = [:]

        var body: some View {
            let q = questions[min(index, questions.count - 1)]
            let picked = picks[index]
            let score = picks.filter { questions[$0.key].correct == $0.value }.count
            let finished = picks.count == questions.count

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(title).font(.system(size: 14.5, weight: .medium))
                    Spacer()
                    Text("\(index + 1) / \(questions.count)\(picks.isEmpty ? "" : "  ·  \(score) correct")")
                        .font(.system(size: 13).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
                .padding(.horizontal, 16)
                .frame(height: 44)
                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text(q.question).font(.system(size: 16)).lineSpacing(3).padding(.bottom, 4)
                    ForEach(Array(q.options.enumerated()), id: \.offset) { i, text in
                        option(i, text, q: q, picked: picked)
                    }
                    if picked != nil, !q.explanation.isEmpty {
                        (Text(picked == q.correct ? "Correct. " : "Answer: ").fontWeight(.medium) + Text(q.explanation))
                            .font(.system(size: 14.5))
                            .lineSpacing(3)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.wash, in: .rect(cornerRadius: 12, style: .continuous))
                            .transition(.opacity.combined(with: .offset(y: 4)))
                    }
                }
                .padding(16)
                .id(index)
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: 12)), removal: .opacity))

                Divider()
                HStack {
                    CardButton(title: "Back", disabled: index == 0) { withAnimation(Motion.morph) { index -= 1 } }
                    Spacer()
                    if finished && index == questions.count - 1 {
                        Text("Score \(score)/\(questions.count)").font(.system(size: 14).monospacedDigit()).foregroundStyle(.secondary)
                        CardButton(title: "Retry", systemImage: "arrow.counterclockwise", style: .secondary) {
                            withAnimation(Motion.morph) { picks = [:]; index = 0 }
                        }
                    } else {
                        CardButton(title: "Next", style: picked != nil ? .primary : .ghost, disabled: index == questions.count - 1) {
                            withAnimation(Motion.morph) { index += 1 }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .frame(height: 50)
            }
            .opalCard()
            .sensoryFeedback(trigger: picks) { old, new in
                guard let first = new.first(where: { old[$0.key] == nil }) else { return nil }
                return questions[first.key].correct == first.value ? .success : .error
            }
        }

        private func option(_ i: Int, _ text: String, q: Q, picked: Int?) -> some View {
            let answered = picked != nil
            let isCorrect = i == q.correct
            let isPicked = picked == i
            let border: Color = !answered ? Color.primary.opacity(0.12) : isCorrect ? Color.success.opacity(0.5) : isPicked ? Color.danger.opacity(0.5) : Color.primary.opacity(0.06)
            let fill: Color = answered && isCorrect ? Color.success.opacity(0.1) : answered && isPicked ? Color.danger.opacity(0.1) : .clear
            return VStack(alignment: .leading, spacing: 6) {
                Button {
                    guard !answered else { return }
                    withAnimation(Motion.morph) { picks[index] = i }
                    if !isCorrect { shakes[i, default: 0] += 1 }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        ZStack {
                            Circle().strokeBorder(Color.primary.opacity(0.15)).frame(width: 22, height: 22)
                            if answered && isCorrect {
                                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Color.success)
                            } else if answered && isPicked {
                                Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Color.danger)
                            } else {
                                Text(String(Character(UnicodeScalar(UInt8(65 + min(i, 25)))))).font(.system(size: 11.5)).foregroundStyle(.secondary)
                            }
                        }
                        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
                        Text(text)
                            .font(.system(size: 15))
                            .multilineTextAlignment(.leading)
                            .foregroundStyle(answered && !isPicked && !isCorrect ? .secondary : .primary)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(fill, in: .rect(cornerRadius: 12, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(border) }
                    .contentShape(.rect)
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .modifier(Shake(trigger: shakes[i] ?? 0))
                .accessibilityAddTraits(isPicked ? .isSelected : [])
                if answered, isPicked, !isCorrect, i < q.wrong.count, !q.wrong[i].isEmpty {
                    Text(q.wrong[i]).font(.system(size: 14)).foregroundStyle(.secondary).padding(.leading, 44)
                }
            }
        }
    }
}

// MARK: Flashcards

/// Flashcards. The flip is a real turn of one card (front and back are its two sides): the one
/// place where motion explains the interaction itself.
struct FlashcardsView: View {
    let call: ToolCall

    private struct Card { let front: String; let back: String; let hint: String? }

    var body: some View {
        let cards: [Card] = (call.input?["cards"]?.array ?? []).compactMap { c in
            guard let f = c["front"]?.string, let b = c["back"]?.string, !f.isEmpty, !b.isEmpty else { return nil }
            return Card(front: f, back: b, hint: c["hint"]?.string)
        }
        if call.state == "input-streaming" || cards.isEmpty {
            if call.state != "output-error" { SkeletonBlock(height: 230) }
        } else {
            Deck(title: call.input?["title"]?.string ?? "Flashcards", cards: cards)
        }
    }

    private struct Deck: View {
        let title: String
        let cards: [Card]
        @State private var i = 0
        @State private var flipped = false
        @State private var known: Set<Int> = []
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            let card = cards[i]
            VStack(spacing: 0) {
                HStack {
                    Text(title).font(.system(size: 14.5, weight: .medium))
                    Spacer()
                    Text("\(i + 1) / \(cards.count)\(known.isEmpty ? "" : "  ·  \(known.count) known")")
                        .font(.system(size: 13).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .frame(height: 44)
                Divider()

                Button {
                    withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .timingCurve(0.23, 1, 0.32, 1, duration: 0.45)) { flipped.toggle() }
                } label: {
                    ZStack {
                        face {
                            Text(card.front).font(.system(size: 18, weight: .medium)).lineSpacing(4)
                            if let hint = card.hint, !hint.isEmpty {
                                Text("Hint: \(hint)").font(.system(size: 13)).foregroundStyle(.tertiary).padding(.top, 6)
                            }
                        }
                        .opacity(flipped ? 0 : 1)
                        face {
                            Text(card.back).font(.system(size: 16)).lineSpacing(3)
                        }
                        .rotation3DEffect(.degrees(180), axis: (0, 1, 0))
                        .opacity(flipped ? 1 : 0)
                    }
                    .rotation3DEffect(.degrees(reduceMotion ? 0 : flipped ? 180 : 0), axis: (0, 1, 0), perspective: 0.5)
                    .contentShape(.rect)
                }
                .buttonStyle(PressableStyle(scale: 0.985))
                .accessibilityLabel(flipped ? card.back : card.front)
                .accessibilityHint(flipped ? "Shows the front" : "Shows the answer")
                .padding(16)
                .sensoryFeedback(.selection, trigger: flipped)

                Divider()
                HStack(spacing: 2) {
                    iconButton("arrow.left", "Previous") { go(-1) }
                    iconButton("arrow.right", "Next") { go(1) }
                    Spacer()
                    CardButton(title: "Again") { known.remove(i); go(1) }
                    CardButton(title: "Got it", style: .secondary) { known.insert(i); go(1) }
                    if known.count == cards.count {
                        iconButton("arrow.counterclockwise", "Restart") { known = [] }
                    }
                }
                .padding(.horizontal, 8)
                .frame(height: 50)
            }
            .opalCard()
        }

        private func go(_ d: Int) {
            flipped = false
            withAnimation(Motion.morph) { i = (i + d + cards.count) % cards.count }
        }

        private func face<C: View>(@ViewBuilder _ content: () -> C) -> some View {
            VStack(spacing: 0) { content() }
                .multilineTextAlignment(.center)
                .foregroundStyle(.primary)
                .padding(.horizontal, 22)
                .frame(maxWidth: .infinity, minHeight: 190)
                .background(Color.canvas, in: .rect(cornerRadius: 12, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.08)) }
        }

        private func iconButton(_ image: String, _ label: String, action: @escaping () -> Void) -> some View {
            Button(action: action) {
                Image(systemName: image).font(.system(size: 15)).frame(width: 38, height: 34).contentShape(.rect)
            }
            .buttonStyle(PressableStyle())
            .foregroundStyle(.primary)
            .accessibilityLabel(label)
        }
    }
}

// MARK: Secret request

/// Opal asks for a password or key. The value goes straight to the vault (encrypted); the chat
/// only hears "saved", and the model gets a placeholder, never the value.
struct SecretRequestView: View {
    let call: ToolCall
    let model: ChatModel
    @Environment(SessionStore.self) private var session
    @State private var value = ""
    @State private var pending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        let input = call.input
        let label = input?["label"]?.string ?? input?["name"]?.string ?? "Secret"
        if call.state == "input-streaming" {
            EmptyView()
        } else if call.state == "output-available" {
            let saved = call.output?["status"]?.string == "saved"
            HStack(spacing: 7) {
                Image(systemName: saved ? "checkmark" : "lock").foregroundStyle(saved ? Color.success : .secondary)
                Text(saved ? "\(label) saved to vault" : "\(label) not provided")
            }
            .font(.system(size: 14.5))
            .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "lock").foregroundStyle(.secondary)
                    Text("Opal needs a secret").font(.system(size: 15, weight: .medium))
                }
                if let reason = input?["reason"]?.string, !reason.isEmpty {
                    Text(reason).font(.system(size: 14)).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
                    SecureField("", text: $value)
                        .textContentType(.password)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { Task { await save() } }
                        .padding(.horizontal, 12)
                        .frame(height: 42)
                        .background(Color.wash, in: .rect(cornerRadius: 10, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(error == nil ? .clear : Color.danger.opacity(0.6)) }
                    if let error { Text(error).font(.system(size: 12.5)).foregroundStyle(Color.danger) }
                }
                Text("Saved encrypted in your vault. The AI never sees the value.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.tertiary)
                HStack(spacing: 6) {
                    Spacer()
                    CardButton(title: "Cancel") { model.answer(tool: "request_secret", toolCallId: call.id, output: ["status": .string("declined")]) }
                    CardButton(title: pending ? "Saving" : "Save secret", style: .accent, disabled: value.isEmpty || pending) { Task { await save() } }
                }
            }
            .padding(14)
            .opalCard()
        }
    }

    private func save() async {
        guard !value.isEmpty, !pending else { return }
        pending = true
        error = nil
        defer { pending = false }
        let input = call.input
        let body: [String: JSONValue] = [
            "name": .string(input?["name"]?.string ?? ""),
            "label": .string(input?["label"]?.string ?? input?["name"]?.string ?? ""),
            "description": .string(input?["reason"]?.string ?? ""),
            "value": .string(value),
        ]
        do {
            _ = try await session.api.sendRaw("/api/secrets", json: JSONValue.object(body))
            value = ""
            model.answer(tool: "request_secret", toolCallId: call.id, output: ["status": .string("saved")])
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: Ask user

/// Opal asks a question with a few answers to tap (and, if it allows, one of your own).
struct AskUserView: View {
    let call: ToolCall
    let model: ChatModel
    @State private var other = ""

    var body: some View {
        let input = call.input
        let answered: String? = call.state == "output-available" ? (call.output?["answer"]?.string ?? "") : nil
        if call.state == "input-streaming" {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text(input?["question"]?.string ?? "").font(.system(size: 15, weight: .medium))
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach((input?["options"]?.array ?? []).compactMap(\.string), id: \.self) { o in
                        Button { answer(o) } label: {
                            Text(o)
                                .font(.system(size: 14))
                                .foregroundStyle(answered == o ? .primary : Color.primary.opacity(0.85))
                                .padding(.horizontal, 13)
                                .frame(height: 34)
                                .background(answered == o ? Color.wash : .clear, in: Capsule())
                                .overlay { Capsule().strokeBorder(Color.primary.opacity(answered == o ? 0.25 : 0.12)) }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(answered != nil)
                        .opacity(answered != nil && answered != o ? 0.5 : 1)
                    }
                }
                if input?["allowOther"]?.bool == true && answered == nil {
                    HStack(spacing: 8) {
                        TextField("Something else", text: $other)
                            .font(.system(size: 14.5))
                            .submitLabel(.send)
                            .onSubmit { answer(other) }
                            .padding(.horizontal, 12)
                            .frame(height: 38)
                            .background(Color.wash, in: .rect(cornerRadius: 10, style: .continuous))
                        CardButton(title: "Send", style: .secondary, disabled: other.trimmingCharacters(in: .whitespaces).isEmpty) { answer(other) }
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .opalCard()
        }
    }

    private func answer(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        model.answer(tool: "ask_user", toolCallId: call.id, output: ["answer": .string(String(t.prefix(500)))])
    }
}

// MARK: Generated UI

/// A small interface Opal composed for this answer (json-render spec): cards, metrics, tables,
/// charts, steps, buttons that send a follow-up. Same catalog as the web.
struct GenUIView: View {
    let call: ToolCall
    let model: ChatModel

    var body: some View {
        let spec = call.input?["spec"]
        let root = spec?["root"]?.string
        let elements = spec?["elements"]
        if let root, elements?[root] != nil, let elements {
            if call.state == "output-available", call.output?["ok"]?.bool == false {
                Text("The interactive view had an error: \(call.output?["error"]?.string ?? "")").font(.system(size: 14)).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    if let title = call.input?["title"]?.string { Text(title).font(.system(size: 14)).foregroundStyle(.secondary) }
                    GenNode(id: root, elements: elements, depth: 0) { prompt in
                        model.send(prompt)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if call.state == "input-streaming" {
            SkeletonBlock(height: 120, radius: 12)
        }
    }
}

private struct GenNode: View {
    let id: String
    let elements: JSONValue
    let depth: Int
    let send: (String) -> Void
    @Environment(\.accent) private var accent
    @Environment(\.openURL) private var openURL

    var body: some View {
        let el = elements[id]
        let type = el?["type"]?.string ?? ""
        let p = el?["props"] ?? .object([:])
        let children = (el?["children"]?.array ?? []).compactMap(\.string).filter { elements[$0] != nil }
        if depth < 12 { node(type, p, children) }
    }

    private func kids(_ children: [String]) -> some View {
        ForEach(children, id: \.self) { c in
            AnyView(GenNode(id: c, elements: elements, depth: depth + 1, send: send))
        }
    }

    private func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "success": Color.success
        case "warning": Color.warning
        case "danger": Color.danger
        case "accent": accent.line
        default: .secondary
        }
    }

    private func https(_ s: String?) -> URL? {
        guard let s, let u = URL(string: s), u.scheme == "https" else { return nil }
        return u
    }

    @ViewBuilder private func node(_ type: String, _ p: JSONValue, _ children: [String]) -> some View {
        switch type {
        case "Stack":
            let gap: CGFloat = p["gap"]?.string == "sm" ? 8 : p["gap"]?.string == "lg" ? 20 : 12
            if p["direction"]?.string == "horizontal" {
                FlowLayout(spacing: gap, lineSpacing: gap) { kids(children) }
            } else {
                VStack(alignment: .leading, spacing: gap) { kids(children) }.frame(maxWidth: .infinity, alignment: .leading)
            }
        case "Grid":
            let cols = min(2, max(1, p["columns"]?.int ?? 2))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .topLeading), count: cols), alignment: .leading, spacing: 12) {
                kids(children)
            }
        case "Card":
            VStack(alignment: .leading, spacing: 0) {
                if let t = p["title"]?.string { Text(t).font(.system(size: 15, weight: .medium)) }
                if let s = p["subtitle"]?.string { Text(s).font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 2) }
                VStack(alignment: .leading, spacing: 12) { kids(children) }
                    .padding(.top, p["title"]?.string != nil || p["subtitle"]?.string != nil ? 12 : 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .opalCard(radius: 14)
        case "Heading":
            let level = p["level"]?.int ?? 2
            Text(p["text"]?.string ?? "").font(.system(size: level == 1 ? 20 : level == 2 ? 17 : 15.5, weight: .medium))
        case "Text":
            Text(p["text"]?.string ?? "")
                .font(.system(size: p["size"]?.string == "sm" ? 14 : 15.5))
                .lineSpacing(3)
                .foregroundStyle(p["muted"]?.bool == true ? .secondary : .primary)
        case "Metric":
            VStack(alignment: .leading, spacing: 2) {
                Text(p["label"]?.string ?? "").font(.system(size: 13)).foregroundStyle(.secondary)
                Text(p["value"]?.string ?? "").font(.system(size: 24, weight: .medium).monospacedDigit())
                if let change = p["change"]?.string { Text(change).font(.system(size: 13).monospacedDigit()).foregroundStyle(toneColor(p["tone"]?.string)) }
            }
        case "Badge":
            Text(p["text"]?.string ?? "")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(p["tone"]?.string == nil || p["tone"]?.string == "accent" || p["tone"]?.string == "neutral" ? .secondary : toneColor(p["tone"]?.string))
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(Color.wash, in: Capsule())
        case "KeyValue":
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 6) {
                ForEach(Array((p["items"]?.array ?? []).enumerated()), id: \.offset) { _, it in
                    GridRow {
                        Text(it["key"]?.string ?? "").foregroundStyle(.secondary)
                        Text(it["value"]?.string ?? "").monospacedDigit()
                    }
                }
            }
            .font(.system(size: 14.5))
        case "List":
            let ordered = p["ordered"]?.bool == true
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array((p["items"]?.array ?? []).enumerated()), id: \.offset) { i, it in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(i + 1)." : "•").foregroundStyle(.tertiary).monospacedDigit()
                        Text(it.string ?? "")
                    }
                }
            }
            .font(.system(size: 15))
        case "Table":
            MarkdownTable(header: (p["columns"]?.array ?? []).map { $0.string ?? "" }, rows: Array((p["rows"]?.array ?? []).prefix(50)).map { $0.array.map { $0.string ?? ($0.number.map { String($0) } ?? "") } }, size: 16)
        case "BarChart":
            let data = Array((p["data"]?.array ?? []).prefix(24))
            let maxV = max(1, data.map { abs($0["value"]?.number ?? 0) }.max() ?? 1)
            VStack(alignment: .leading, spacing: 8) {
                if let t = p["title"]?.string { Text(t).font(.system(size: 14, weight: .medium)) }
                ForEach(Array(data.enumerated()), id: \.offset) { _, d in
                    let v = d["value"]?.number ?? 0
                    HStack(spacing: 8) {
                        Text(d["label"]?.string ?? "").foregroundStyle(.secondary).lineLimit(1).frame(width: 90, alignment: .leading)
                        GeometryReader { g in
                            Capsule().fill(Color.primary.opacity(0.7)).frame(width: max(4, g.size.width * abs(v) / maxV))
                        }
                        .frame(height: 10)
                        Text(Self.number(v) + (p["unit"]?.string ?? "")).monospacedDigit()
                    }
                    .font(.system(size: 13))
                }
            }
        case "Progress":
            let v = min(100, max(0, p["value"]?.number ?? 0))
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(p["label"]?.string ?? "").foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Int(v.rounded()))%").monospacedDigit()
                }
                .font(.system(size: 13))
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.wash)
                        Capsule().fill(Color.primary.opacity(0.75)).frame(width: g.size.width * v / 100)
                    }
                }
                .frame(height: 6)
            }
        case "Steps":
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array((p["items"]?.array ?? []).enumerated()), id: \.offset) { i, s in
                    let done = s["done"]?.bool == true
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(i + 1)")
                            .font(.system(size: 11.5).monospacedDigit())
                            .foregroundStyle(done ? Color.canvas : .secondary)
                            .frame(width: 22, height: 22)
                            .background(done ? Color.ink : .clear, in: Circle())
                            .overlay { Circle().strokeBorder(done ? .clear : Color.primary.opacity(0.15)) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s["title"]?.string ?? "").font(.system(size: 15)).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
                            if let d = s["detail"]?.string { Text(d).font(.system(size: 13)).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        case "Callout":
            let tone = p["tone"]?.string
            VStack(alignment: .leading, spacing: 2) {
                if let t = p["title"]?.string { Text(t).font(.system(size: 14.5, weight: .medium)) }
                Text(p["text"]?.string ?? "").font(.system(size: 14.5)).lineSpacing(3)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone == "danger" ? Color.danger.opacity(0.08) : tone == "warning" ? Color.warning.opacity(0.1) : Color.wash, in: .rect(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tone == "danger" ? Color.danger.opacity(0.3) : tone == "warning" ? Color.warning.opacity(0.3) : Color.primary.opacity(0.06)) }
        case "Image":
            if let url = https(p["src"]?.string) {
                VStack(alignment: .leading, spacing: 4) {
                    AsyncImage(url: url) { img in
                        img.resizable().scaledToFit()
                    } placeholder: {
                        SkeletonBlock(height: 160, radius: 12)
                    }
                    .frame(maxHeight: 320)
                    .clipShape(.rect(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel(p["alt"]?.string ?? "")
                    if let c = p["caption"]?.string { Text(c).font(.system(size: 12.5)).foregroundStyle(.secondary) }
                }
            }
        case "Link":
            if let url = https(p["href"]?.string) {
                Button { openURL(url) } label: {
                    Text(p["text"]?.string ?? url.absoluteString).font(.system(size: 15)).underline().foregroundStyle(accent.line)
                }
                .buttonStyle(PressableStyle())
            } else {
                Text(p["text"]?.string ?? "")
            }
        case "Button":
            let primary = p["primary"]?.bool == true
            Button { send(p["prompt"]?.string ?? p["label"]?.string ?? "") } label: {
                Text(p["label"]?.string ?? "")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(primary ? accent.fg : .primary)
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .background(primary ? accent.fill : Color.wash, in: .rect(cornerRadius: 10, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(primary ? .clear : Color.primary.opacity(0.1)) }
            }
            .buttonStyle(PressableStyle())
        case "Separator":
            Divider()
        default:
            EmptyView()
        }
    }

    static func number(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.2f", v).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
    }
}

// MARK: Handwriting artifact

/// Opal's answer written out by hand on A4, in your handwriting once you've set it up.
struct HandwritingArtifactView: View {
    let call: ToolCall
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @Environment(\.accent) private var accent
    @State private var artifact: HandwritingDoc?

    var body: some View {
        let id = call.state == "output-available" ? call.output?["artifactId"]?.string : nil
        if call.state == "output-error" {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: "signature").font(.system(size: 14))
                    if let artifact {
                        Text(artifact.title).lineLimit(1)
                        if artifact.profileId == nil {
                            Button("Use your own handwriting") { shell.open(.settings(.handwriting)) }
                                .font(.system(size: 13))
                                .underline()
                                .foregroundStyle(accent.line)
                                .buttonStyle(PressableStyle())
                        }
                    } else {
                        ShimmerText(text: "Writing by hand")
                    }
                }
                .font(.system(size: 14.5))
                .foregroundStyle(.secondary)
                if let artifact {
                    HandwritingView(markdown: artifact.markdown, profileId: artifact.profileId, paper: artifact.paper, ink: artifact.ink, title: artifact.title, compact: true)
                } else {
                    SkeletonBlock(height: 300 * 297 / 210, radius: 6).frame(maxWidth: 300)
                }
            }
            .task(id: id) {
                guard let id else { return }
                if let doc = try? await HandwritingDoc.load(id, api: session.api) {
                    withAnimation(Motion.morph) { artifact = doc }
                }
            }
        }
    }
}
