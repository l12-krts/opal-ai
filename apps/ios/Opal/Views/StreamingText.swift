import SwiftUI

/// Markdown text that fades in as it streams: each new piece starts transparent and settles to
/// full strength, while what's already there stays put. Text that's there when the view appears
/// (history, scrolling back) shows at once.
struct StreamingText: View {
    let text: String

    @State private var parsed = AttributedString()
    @State private var shown = 0
    @State private var pieces: [Piece] = []

    /// A fading stretch of text: where it starts (in characters) and when it arrived.
    private struct Piece { let start: Int; let born: Date }
    private static let fade: TimeInterval = 0.45

    var body: some View {
        TimelineView(.animation(paused: pieces.isEmpty)) { context in
            Text(styled(at: context.date))
        }
        .onAppear { update(fading: false) }
        .onChange(of: text) { update(fading: true) }
        .task(id: shown) {
            // Once the last piece has settled, stop redrawing every frame.
            try? await Task.sleep(for: .seconds(Self.fade + 0.05))
            let now = Date.now
            pieces.removeAll { now.timeIntervalSince($0.born) >= Self.fade }
        }
    }

    private func update(fading: Bool) {
        let next = Self.markdown(text)
        let count = next.characters.count
        let now = Date.now
        pieces.removeAll { now.timeIntervalSince($0.born) >= Self.fade }
        if count < shown {
            // Replaced rather than extended: no fade.
            pieces.removeAll()
        } else if fading && count > shown {
            pieces.append(Piece(start: shown, born: now))
        }
        shown = count
        parsed = next
    }

    private func styled(at date: Date) -> AttributedString {
        let live = pieces.filter { date.timeIntervalSince($0.born) < Self.fade }
        guard !live.isEmpty else { return parsed }
        var out = parsed
        let total = out.characters.count
        for (i, piece) in live.enumerated() {
            let end = min(i + 1 < live.count ? live[i + 1].start : total, total)
            guard piece.start < end else { continue }
            let t = min(max(date.timeIntervalSince(piece.born) / Self.fade, 0), 1)
            let eased = 1 - pow(1 - t, 3) // ease-out: visible straight away, settles gently
            let lo = out.characters.index(out.startIndex, offsetBy: piece.start)
            let hi = out.characters.index(out.startIndex, offsetBy: end)
            out[lo..<hi].foregroundColor = Color.primary.opacity(0.08 + 0.92 * eased)
        }
        return out
    }

    static func markdown(_ s: String) -> AttributedString {
        MarkdownBlock.inline(s)
    }
}
