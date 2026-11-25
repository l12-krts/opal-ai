import SwiftUI
import UIKit

// A document in a chat (a card with a preview), full screen (a sheet), and shared out
// (Markdown, PDF, CSV or an image, through the share sheet).

// MARK: In the chat

/// create_doc, create_slides, create_sheet, create_chart, create_whiteboard, update_document and
/// show_document. While a create streams in, the card builds from what's arrived; once saved, it
/// keeps the version that call made.
struct DocumentToolView: View {
    let call: ToolCall

    var body: some View {
        let result = DocSnapshot.from(call)
        let failed = call.failed || call.output?["ok"]?.bool == false
        if failed {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Color.danger)
                Text(failureLabel).foregroundStyle(.secondary)
                    + Text((call.error ?? call.output?["error"]?.string).map { ": \($0)" } ?? "").foregroundStyle(.tertiary)
            }
            .font(.system(size: 14.5))
        } else if call.state == "output-denied" {
            EmptyView()
        } else if let snap = result.snap {
            DocumentCard(snap: snap, building: result.building)
        } else if DocKind.forTool(call.name) != nil {
            SkeletonBlock(height: 240)
        } else {
            HStack(spacing: 7) {
                Image(systemName: "doc.text").font(.system(size: 14))
                ShimmerText(text: call.name == "show_document" ? "Opening the document" : "Changing the document")
            }
            .font(.system(size: 14.5))
            .foregroundStyle(.secondary)
            .frame(minHeight: 28)
        }
    }

    private var failureLabel: String {
        if let kind = DocKind.forTool(call.name) { return "Couldn't make the \(kind == .doc ? "document" : kind.label.lowercased())" }
        return call.name == "show_document" ? "Couldn't open the document" : "Couldn't change the document"
    }
}

/// A document's card: a preview that opens it full screen, its name, what's in it, and share.
struct DocumentCard: View {
    let snap: DocSnapshot
    var building = false
    @State private var open: DocSnapshot?

    var body: some View {
        VStack(spacing: 0) {
            Button { open = snap } label: {
                DocPreview(snap: snap, height: 180)
                    .overlay(alignment: .topTrailing) {
                        if !building {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 30, height: 30)
                                .opalGlass(in: Circle())
                                .padding(10)
                        }
                    }
                    .contentShape(.rect)
            }
            .buttonStyle(PressableStyle(scale: 0.99))
            .disabled(building)
            .accessibilityLabel("Open \(snap.displayTitle)")
            .accessibilityIdentifier("document-\(snap.kind.rawValue)")

            Divider()

            HStack(spacing: 12) {
                Image(systemName: snap.systemImage)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(Color.wash, in: .rect(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(snap.displayTitle).font(.system(size: 15, weight: .medium)).lineLimit(1)
                    if building {
                        ShimmerText(text: "Writing \(snap.kind.label.lowercased())").font(.system(size: 13))
                    } else {
                        Text("\(snap.kind.label) · \(snap.summary)\(snap.version > 1 ? " · Version \(snap.version)" : "")")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if !building {
                    DocShareMenu(snap: snap)
                    CardButton(title: "Open", style: .secondary) { open = snap }
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .frame(height: 60)
        }
        .opalCard()
        .sheet(item: $open) { s in
            DocumentViewer(snap: s)
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: Sharing

/// The share button: what this kind of document can be shared as.
struct DocShareMenu: View {
    let snap: DocSnapshot
    var compact = true
    @State private var failed = false

    var body: some View {
        Menu {
            ForEach(DocExport.options(for: snap), id: \.label) { option in
                Button {
                    do { presentActivity([try option.make()]) } catch { failed = true }
                } label: {
                    Label(option.label, systemImage: option.systemImage)
                }
            }
        } label: {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: compact ? 15 : 17, weight: .medium))
                .foregroundStyle(compact ? .secondary : .primary)
                .frame(width: 38, height: 36)
                .contentShape(.rect)
        }
        .accessibilityLabel("Share")
        .alert("Couldn't make the file", isPresented: $failed) { Button("OK", role: .cancel) {} }
    }
}

@MainActor
enum DocExport {
    struct Option {
        let label: String
        let systemImage: String
        let make: @MainActor () throws -> URL
    }

    struct Failure: Error {}

    static func options(for snap: DocSnapshot) -> [Option] {
        let t = snap.displayTitle
        switch snap.content {
        case .doc(let md):
            return [
                Option(label: "PDF", systemImage: "doc.richtext") { try docPDF(title: t, markdown: md) },
                Option(label: "Markdown", systemImage: "doc.plaintext") { try write(markdownWithTitle(t, md), t, "md") },
            ]
        case .slides(let d):
            return [
                Option(label: "PDF", systemImage: "doc.richtext") { try slidesPDF(title: t, deck: d) },
                Option(label: "Outline (Markdown)", systemImage: "list.bullet") { try write(outline(t, d), t, "md") },
            ]
        case .sheet(let s):
            return [Option(label: "CSV", systemImage: "tablecells") { try write("\u{FEFF}" + SheetFormat.csv(s), t, "csv") }]
        case .chart(let c):
            return [
                Option(label: "Image", systemImage: "photo") { try png(chartImage(title: t, chart: c), size: CGSize(width: 1000, height: 640), title: t) },
                Option(label: "Data (CSV)", systemImage: "tablecells") { try write("\u{FEFF}" + SheetFormat.csv(chartSheet(c)), t, "csv") },
            ]
        case .whiteboard(let w):
            return [Option(label: "Image", systemImage: "photo") { try boardPNG(title: t, board: w) }]
        }
    }

    // MARK: Files

    private static func url(_ title: String, _ ext: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Opal documents", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|")
        let name = title.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return dir.appendingPathComponent("\(name.isEmpty ? "Document" : String(name.prefix(80))).\(ext)")
    }

    private static func write(_ text: String, _ title: String, _ ext: String) throws -> URL {
        let u = try url(title, ext)
        try Data(text.utf8).write(to: u, options: .atomic)
        return u
    }

    private static func markdownWithTitle(_ title: String, _ md: String) -> String {
        md.trimmingCharacters(in: .whitespaces).hasPrefix("# ") ? md : "# \(title)\n\n\(md)"
    }

    private static func outline(_ title: String, _ d: SlidesDoc) -> String {
        var parts = ["# \(title)"]
        for (i, s) in d.slides.enumerated() {
            var p = ["## \(i + 1). \(s.title)"]
            if let sub = s.subtitle { p.append("_\(sub)_") }
            if !s.bullets.isEmpty { p.append(s.bullets.map { "- \($0)" }.joined(separator: "\n")) }
            if let b = s.body { p.append(b) }
            if let n = s.notes { p.append("> Notes: \(n.replacingOccurrences(of: "\n", with: " "))") }
            parts.append(p.joined(separator: "\n\n"))
        }
        return parts.joined(separator: "\n\n")
    }

    private static func chartSheet(_ c: ChartDoc) -> SheetDoc {
        var columns = [SheetColumn(name: "Label", type: "text")]
        for (i, s) in c.series.enumerated() {
            columns.append(SheetColumn(name: s.name.isEmpty ? "Series \(i + 1)" : s.name, type: "number"))
        }
        var rows: [[SheetCell]] = []
        for (i, label) in c.labels.enumerated() {
            var row: [SheetCell] = [.text(label)]
            for s in c.series {
                if i < s.values.count, let v = s.values[i] { row.append(.number(v)) } else { row.append(.empty) }
            }
            rows.append(row)
        }
        return SheetDoc(columns: columns, rows: rows, currency: nil)
    }

    // MARK: Images

    private static func chartImage(title: String, chart: ChartDoc) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.system(size: 24, weight: .semibold))
            ChartDocView(chart: chart)
            if let caption = chart.caption { Text(caption).font(.system(size: 14)).foregroundStyle(.secondary) }
        }
        .padding(32)
    }

    private static func png<V: View>(_ view: V, size: CGSize, title: String, scale: CGFloat = 2) throws -> URL {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height).background(Color.white).environment(\.colorScheme, .light))
        renderer.scale = scale
        guard let data = renderer.uiImage?.pngData() else { throw Failure() }
        let u = try url(title, "png")
        try data.write(to: u, options: .atomic)
        return u
    }

    private static func boardPNG(title: String, board: WhiteboardDoc) throws -> URL {
        let b = board.bounds
        let view = WhiteboardView(board: board, origin: b.origin, scale: 1)
        return try png(view, size: b.size, title: title, scale: min(2, 4000 / max(b.width, b.height)))
    }

    // MARK: PDFs

    /// One slide per page, 16:9.
    private static func slidesPDF(title: String, deck: SlidesDoc) throws -> URL {
        let u = try url(title, "pdf")
        var box = CGRect(x: 0, y: 0, width: 960, height: 540)
        guard let pdf = CGContext(u as CFURL, mediaBox: &box, nil) else { throw Failure() }
        for (i, s) in deck.slides.enumerated() {
            let renderer = ImageRenderer(content: SlideView(slide: s, theme: deck.theme, index: i, total: deck.slides.count).frame(width: 960, height: 540))
            renderer.render { _, draw in
                pdf.beginPDFPage(nil)
                draw(pdf)
                pdf.endPDFPage()
            }
        }
        pdf.closePDF()
        return u
    }

    /// A4 pages of real (selectable) text, laid out by UIKit's print system.
    private static func docPDF(title: String, markdown: String) throws -> URL {
        let u = try url(title, "pdf")
        let text = attributed(markdownWithTitle(title, markdown))
        let formatter = UISimpleTextPrintFormatter(attributedText: text)
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)
        let page = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        renderer.setValue(NSValue(cgRect: page), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: page.insetBy(dx: 50, dy: 56)), forKey: "printableRect")
        guard UIGraphicsBeginPDFContextToFile(u.path, page, nil) else { throw Failure() }
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for i in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return u
    }

    /// Markdown as styled text for printing: headings, lists, quotes, code and tables.
    private static func attributed(_ md: String) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let ink = UIColor(white: 0.1, alpha: 1)
        let muted = UIColor(white: 0.4, alpha: 1)

        func style(spacingBefore: CGFloat = 0, after: CGFloat = 8, indent: CGFloat = 0, hanging: CGFloat = 0, tabs: [NSTextTab] = []) -> NSParagraphStyle {
            let p = NSMutableParagraphStyle()
            p.paragraphSpacingBefore = spacingBefore
            p.paragraphSpacing = after
            p.lineSpacing = 2.5
            p.firstLineHeadIndent = indent
            p.headIndent = indent + hanging
            if !tabs.isEmpty { p.tabStops = tabs }
            return p
        }

        func inline(_ s: String, size: CGFloat, weight: UIFont.Weight = .regular, color given: UIColor? = nil, italic: Bool = false, para: NSParagraphStyle) -> NSAttributedString {
            let color = given ?? ink
            let result = NSMutableAttributedString()
            let attr = MarkdownBlock.inline(s)
            for run in attr.runs {
                let piece = String(attr[run.range].characters)
                let intent = run.inlinePresentationIntent ?? []
                var font = UIFont.systemFont(ofSize: size, weight: intent.contains(.stronglyEmphasized) ? .semibold : weight)
                if intent.contains(.code) { font = UIFont.monospacedSystemFont(ofSize: size * 0.9, weight: .regular) }
                if italic || intent.contains(.emphasized), let d = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {
                    font = UIFont(descriptor: d, size: font.pointSize)
                }
                result.append(NSAttributedString(string: piece, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: para]))
            }
            return result
        }

        func add(_ block: MarkdownBlock, quoted: Bool = false) {
            let color = quoted ? muted : ink
            let indent: CGFloat = quoted ? 16 : 0
            switch block {
            case .heading(let level, let text):
                let size: CGFloat = level == 1 ? 21 : level == 2 ? 16 : 13.5
                out.append(inline(text, size: size, weight: .semibold, color: color, para: style(spacingBefore: level == 1 ? 4 : 12, after: 6, indent: indent)))
            case .paragraph(let text):
                out.append(inline(text, size: 11.5, color: color, italic: quoted, para: style(indent: indent)))
            case .listItem(let depth, let marker, let text):
                let left = indent + CGFloat(depth) * 16
                out.append(inline("\(marker ?? "•")\t\(text)", size: 11.5, color: color, para: style(after: 4, indent: left, hanging: 16, tabs: [NSTextTab(textAlignment: .left, location: left + 16)])))
            case .code(_, let text):
                out.append(NSAttributedString(string: text, attributes: [
                    .font: UIFont.monospacedSystemFont(ofSize: 10, weight: .regular),
                    .foregroundColor: ink,
                    .backgroundColor: UIColor(white: 0.95, alpha: 1),
                    .paragraphStyle: style(after: 10, indent: 6),
                ]))
            case .quote(let inner):
                for b in inner { add(b, quoted: true) }
                return
            case .table(let header, let rows):
                let width: CGFloat = 495
                let col = width / CGFloat(max(1, header.count))
                let tabs = (1..<max(2, header.count)).map { NSTextTab(textAlignment: .left, location: CGFloat($0) * col) }
                out.append(inline(header.joined(separator: "\t"), size: 10.5, weight: .semibold, para: style(after: 3, tabs: tabs)))
                for r in rows { out.append(inline("\n" + r.joined(separator: "\t"), size: 10.5, para: style(after: 3, tabs: tabs))) }
            case .rule:
                out.append(NSAttributedString(string: "\u{2014}\u{2014}\u{2014}", attributes: [.foregroundColor: muted, .font: UIFont.systemFont(ofSize: 11), .paragraphStyle: style(spacingBefore: 4, after: 10)]))
            }
            out.append(NSAttributedString(string: "\n", attributes: [.font: UIFont.systemFont(ofSize: 11.5)]))
        }

        for block in MarkdownBlock.parse(md) { add(block) }
        return out
    }
}

// MARK: Full screen

/// A document full screen. Opens on the version it was given; when the document has changed
/// since, offers the latest.
struct DocumentViewer: View {
    let snap: DocSnapshot
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var latest: DocSnapshot?
    @State private var showLatest = false

    private var shown: DocSnapshot { showLatest ? (latest ?? snap) : snap }

    var body: some View {
        NavigationStack {
            content(shown)
                .navigationTitle(shown.displayTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                    ToolbarItem(placement: .primaryAction) { DocShareMenu(snap: shown, compact: false) }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let latest, latest.version > snap.version, !showLatest {
                        Button {
                            withAnimation(Motion.morph) { showLatest = true }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "clock.arrow.circlepath")
                                Text("This is version \(snap.version).")
                                    .foregroundStyle(.secondary)
                                Text("Show version \(latest.version)").underline()
                                Spacer(minLength: 0)
                            }
                            .font(.system(size: 14))
                            .padding(.horizontal, 16)
                            .frame(height: 40)
                            .background(Color.wash)
                        }
                        .buttonStyle(.plain)
                        .transition(.opacity)
                    }
                }
        }
        .accessibilityIdentifier("document-viewer")
        .task {
            guard let id = snap.artifactId else { return }
            struct Res: Decodable { let artifact: JSONValue }
            if let a = try? await session.api.send("/api/artifacts/\(id)", as: Res.self).artifact, let s = DocSnapshot(artifact: a) {
                withAnimation(Motion.morph) { latest = s }
            }
        }
    }

    @ViewBuilder private func content(_ s: DocSnapshot) -> some View {
        switch s.content {
        case .doc(let md):
            ScrollView {
                MarkdownView(text: md, size: 17)
                    .textSelection(.enabled)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
            }
        case .slides(let d):
            SlidesPager(deck: d)
        case .sheet(let sheet):
            SheetStage(sheet: sheet)
        case .chart(let c):
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ChartDocView(chart: c)
                        .frame(height: 380)
                    if let caption = c.caption {
                        Text(caption).font(.system(size: 14)).foregroundStyle(.secondary)
                    }
                }
                .padding(20)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
        case .whiteboard(let w):
            WhiteboardCanvas(board: w)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

/// Slides one at a time (swipe), thumbnails to jump, speaker notes, and presenting.
private struct SlidesPager: View {
    let deck: SlidesDoc
    @State private var page = 0
    @State private var notes = false
    @State private var presenting = false

    var body: some View {
        let n = deck.slides.count
        VStack(spacing: 0) {
            if n == 0 {
                Text("No slides yet.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TabView(selection: $page) {
                    ForEach(Array(deck.slides.enumerated()), id: \.offset) { i, s in
                        SlideView(slide: s, theme: deck.theme, index: i, total: n)
                            .clipShape(.rect(cornerRadius: 10, style: .continuous))
                            .shadow(color: .black.opacity(0.14), radius: 14, y: 5)
                            .padding(.horizontal, 16)
                            .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(maxHeight: .infinity)

                if notes {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Speaker notes").font(.system(size: 12.5, weight: .medium)).foregroundStyle(.secondary)
                            Text(deck.slides[min(page, n - 1)].notes ?? "No notes on this slide.")
                                .font(.system(size: 15))
                                .foregroundStyle(deck.slides[min(page, n - 1)].notes == nil ? .tertiary : .primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(16)
                    }
                    .frame(maxHeight: 170)
                    .background(Color.wash)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(deck.slides.enumerated()), id: \.offset) { i, s in
                                Button { withAnimation(Motion.morph) { page = i } } label: {
                                    SlideView(slide: s, theme: deck.theme)
                                        .frame(width: 92)
                                        .clipShape(.rect(cornerRadius: 5, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                                .strokeBorder(i == page ? Color.accentColor : Color.primary.opacity(0.12), lineWidth: i == page ? 2 : 1)
                                        }
                                }
                                .buttonStyle(PressableStyle())
                                .accessibilityLabel("Slide \(i + 1): \(s.title)")
                                .id(i)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                    .onChange(of: page) { _, p in withAnimation(Motion.morph) { proxy.scrollTo(p, anchor: .center) } }
                }

                HStack(spacing: 6) {
                    Text("\(min(page, n - 1) + 1) / \(n)").font(.system(size: 14).monospacedDigit()).foregroundStyle(.secondary)
                    Spacer()
                    CardButton(title: "Notes", systemImage: "text.alignleft", style: notes ? .secondary : .ghost) {
                        withAnimation(Motion.morph) { notes.toggle() }
                    }
                    CardButton(title: "Present", systemImage: "play.fill", style: .secondary) { presenting = true }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .fullScreenCover(isPresented: $presenting) {
            PresentView(deck: deck, page: $page)
        }
    }
}

/// Presenting: the slides alone on black. Tap the right side for the next one, the left side for
/// the one before.
private struct PresentView: View {
    let deck: SlidesDoc
    @Binding var page: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(deck.slides.enumerated()), id: \.offset) { i, s in
                    SlideView(slide: s, theme: deck.theme, index: i, total: deck.slides.count)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .overlay {
                HStack(spacing: 0) {
                    Color.clear.contentShape(.rect).onTapGesture { withAnimation(Motion.morph) { page = max(0, page - 1) } }
                        .frame(maxWidth: .infinity)
                    Color.clear.contentShape(.rect).onTapGesture { withAnimation(Motion.morph) { page = min(deck.slides.count - 1, page + 1) } }
                        .frame(maxWidth: .infinity)
                        .layoutPriority(2)
                }
            }
            GlassIconButton("xmark", accessibility: "Stop presenting") { dismiss() }
                .padding(16)
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .environment(\.colorScheme, .dark)
    }
}

/// A sheet full screen: the grid, and the selected cell's formula or value above it.
private struct SheetStage: View {
    let sheet: SheetDoc
    @State private var selected: Cell?

    private struct Cell: Equatable { let row: Int; let col: Int }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(selected.map { "\(SheetFormat.colName($0.col))\($0.row + 2)" } ?? "")
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 52, height: 26)
                    .background(Color.wash, in: .rect(cornerRadius: 6, style: .continuous))
                Text(formula)
                    .font(.system(size: 13.5, design: selected == nil ? .default : .monospaced))
                    .foregroundStyle(selected == nil ? .tertiary : .primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            Divider()
            SheetGridView(sheet: sheet, selected: selected.map { (row: $0.row, col: $0.col) }) { r, c in
                selected = Cell(row: r, col: c)
            }
        }
    }

    private var formula: String {
        guard let s = selected, sheet.rows.indices.contains(s.row), sheet.rows[s.row].indices.contains(s.col) else { return "Tap a cell to see its value or formula" }
        let raw = sheet.rows[s.row][s.col]
        guard raw.isFormula else { return raw.raw }
        let values = SheetEngine(sheet).evaluate()
        let v = values[s.row][s.col]
        return "\(raw.raw)  =  \(SheetFormat.show(v, type: sheet.columns[s.col].type, currency: sheet.currency))"
    }
}
