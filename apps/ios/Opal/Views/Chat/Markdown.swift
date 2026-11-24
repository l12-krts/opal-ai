import SwiftUI
import UIKit

/// Markdown split into blocks. Shared by the chat renderer and the handwriting renderer.
enum MarkdownBlock: Hashable {
    case heading(level: Int, text: String)
    case paragraph(String)
    /// One list item; `depth` 0 for top level. `marker` is "1." for ordered items, nil for bullets.
    case listItem(depth: Int, marker: String?, text: String)
    case code(language: String, text: String)
    case quote([MarkdownBlock])
    case table(header: [String], rows: [[String]])
    case rule

    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var out: [MarkdownBlock] = []
        var para: [String] = []
        var i = 0

        func flush() {
            let text = para.joined(separator: "\n").trimmingCharacters(in: .whitespaces)
            if !text.isEmpty { out.append(.paragraph(text)) }
            para = []
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code. While streaming the fence may not be closed yet: take the rest.
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let fence = String(trimmed.prefix(3))
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    body.append(lines[i])
                    i += 1
                }
                out.append(.code(language: language, text: body.joined(separator: "\n")))
                i += 1
                continue
            }

            if trimmed.isEmpty { flush(); i += 1; continue }

            if let h = heading(trimmed) { flush(); out.append(h); i += 1; continue }

            if trimmed.count >= 3, Set(trimmed.replacingOccurrences(of: " ", with: "")).count == 1, "-*_".contains(trimmed.first!) {
                flush(); out.append(.rule); i += 1; continue
            }

            if trimmed.hasPrefix(">") {
                flush()
                var inner: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix(">") else { break }
                    inner.append(String(t.dropFirst()).trimmingCharacters(in: CharacterSet(charactersIn: " ")))
                    i += 1
                }
                out.append(.quote(parse(inner.joined(separator: "\n"))))
                continue
            }

            if trimmed.hasPrefix("|") || (trimmed.contains("|") && i + 1 < lines.count && isTableRule(lines[i + 1])),
               i + 1 < lines.count, isTableRule(lines[i + 1]) {
                flush()
                let header = cells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard !t.isEmpty, t.contains("|") else { break }
                    var r = cells(t)
                    if r.count < header.count { r += Array(repeating: "", count: header.count - r.count) }
                    rows.append(Array(r.prefix(max(header.count, 1))))
                    i += 1
                }
                out.append(.table(header: header, rows: rows))
                continue
            }

            if let item = listItem(line) {
                flush()
                var text = item.text
                i += 1
                // Lines that carry on the item (indented, not a new item or block).
                while i < lines.count {
                    let next = lines[i]
                    let t = next.trimmingCharacters(in: .whitespaces)
                    guard !t.isEmpty, listItem(next) == nil, next.hasPrefix("  ") || next.hasPrefix("\t") else { break }
                    text += " " + t
                    i += 1
                }
                out.append(.listItem(depth: item.depth, marker: item.marker, text: text))
                continue
            }

            para.append(line)
            i += 1
        }
        flush()
        return out
    }

    private static func heading(_ t: String) -> MarkdownBlock? {
        var level = 0
        for ch in t { if ch == "#" { level += 1 } else { break } }
        guard (1...6).contains(level), t.count > level, t[t.index(t.startIndex, offsetBy: level)] == " " else { return nil }
        return .heading(level: level, text: String(t.dropFirst(level)).trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#")).trimmingCharacters(in: .whitespaces))
    }

    private static func listItem(_ line: String) -> (depth: Int, marker: String?, text: String)? {
        let indent = line.prefix { $0 == " " || $0 == "\t" }.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
        let rest = line.drop { $0 == " " || $0 == "\t" }
        if let first = rest.first, "-*+".contains(first), rest.dropFirst().first == " " {
            var text = String(rest.dropFirst(2))
            // Task lists: "- [ ] x", "- [x] x".
            if text.hasPrefix("[ ] ") { text = "☐ " + text.dropFirst(4) } else if text.lowercased().hasPrefix("[x] ") { text = "☑ " + text.dropFirst(4) }
            return (indent / 2, nil, text)
        }
        let digits = rest.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count < 4 {
            let after = rest.dropFirst(digits.count)
            if let d = after.first, d == "." || d == ")", after.dropFirst().first == " " {
                return (indent / 2, "\(digits).", String(after.dropFirst(2)))
            }
        }
        return nil
    }

    private static func isTableRule(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.contains("-"), t.contains("|") || t.hasPrefix(":") || t.hasPrefix("-") else { return false }
        return t.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(_ row: String) -> [String] {
        var t = row.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Inline markdown (bold, italics, code, links) as attributed text.
    static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }

    /// The same text with the markdown taken out.
    static func plain(_ s: String) -> String { String(inline(s).characters) }
}

/// Markdown as the chat shows it: 17pt text, headings, lists, code blocks you can copy, tables you
/// can scroll, and quotes. While streaming, new text fades in (StreamingText).
struct MarkdownView: View {
    let text: String
    var size: CGFloat = 17

    var body: some View {
        let blocks = MarkdownBlock.parse(text)
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, size: size)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let size: CGFloat

    var body: some View {
        switch block {
        case .heading(let level, let text):
            StreamingText(text: text)
                .font(.system(size: level == 1 ? size + 5 : level == 2 ? size + 2 : size, weight: .semibold))
                .padding(.top, level <= 2 ? 6 : 2)
        case .paragraph(let text):
            StreamingText(text: text)
                .font(.system(size: size))
                .lineSpacing(size * 0.22)
        case .listItem(let depth, let marker, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker ?? (depth == 0 ? "•" : "◦"))
                    .font(.system(size: size).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(minWidth: marker == nil ? 10 : 18, alignment: .trailing)
                StreamingText(text: text)
                    .font(.system(size: size))
                    .lineSpacing(size * 0.22)
            }
            .padding(.leading, CGFloat(depth) * 20)
            .padding(.vertical, -3)
        case .code(let language, let text):
            CodeBlock(language: language, text: text)
        case .quote(let inner):
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 1).fill(Color.primary.opacity(0.18)).frame(width: 3)
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(inner.enumerated()), id: \.offset) { _, b in MarkdownBlockView(block: b, size: size) }
                }
                .foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .table(let header, let rows):
            MarkdownTable(header: header, rows: rows, size: size)
        case .rule:
            Divider().padding(.vertical, 4)
        }
    }
}

/// A fenced code block: language on top, copy button, scrolls sideways.
struct CodeBlock: View {
    let language: String
    let text: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.4)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 32, height: 28)
                        .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(copied ? "Copied" : "Copy code")
                .sensoryFeedback(.success, trigger: copied) { _, now in now }
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .padding(.top, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(size: 13.5, design: .monospaced))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
                    .padding(.top, 2)
            }
        }
        .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
    }
}

/// A markdown table: a grid that scrolls sideways when it's wider than the screen.
struct MarkdownTable: View {
    let header: [String]
    let rows: [[String]]
    var size: CGFloat = 17

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, h in
                        cell(h).font(.system(size: size - 2, weight: .semibold))
                    }
                }
                .background(Color.wash)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider().gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, c in
                            cell(c).font(.system(size: size - 2))
                        }
                    }
                }
            }
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.1)) }
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
        }
    }

    private func cell(_ s: String) -> some View {
        Text(MarkdownBlock.inline(s))
            .frame(minWidth: 60, maxWidth: 260, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
    }
}
