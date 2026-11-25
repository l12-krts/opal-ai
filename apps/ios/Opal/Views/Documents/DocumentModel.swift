import SwiftUI

// Documents Opal and agents make in a chat: docs, slides, sheets, charts and whiteboards. The
// same shapes, defaults and sheet formulas as the web (apps/web/src/lib/documents.ts): parsing is
// lenient, so a half-streamed tool call or an older document still shows.

/// The tools whose call shows as a document card.
let documentTools: Set<String> = ["create_doc", "create_slides", "create_sheet", "create_chart", "create_whiteboard", "update_document", "show_document"]

enum DocKind: String, CaseIterable, Identifiable, Hashable, Sendable {
    case doc, slides, sheet, chart, whiteboard

    var id: String { rawValue }

    var label: String {
        switch self {
        case .doc: "Document"
        case .slides: "Slides"
        case .sheet: "Sheet"
        case .chart: "Chart"
        case .whiteboard: "Whiteboard"
        }
    }

    var plural: String {
        switch self {
        case .doc: "Docs"
        case .slides: "Slides"
        case .sheet: "Sheets"
        case .chart: "Charts"
        case .whiteboard: "Whiteboards"
        }
    }

    /// The create tool for this kind ("create_slides").
    static func forTool(_ name: String) -> DocKind? {
        guard name.hasPrefix("create_") else { return nil }
        return DocKind(rawValue: String(name.dropFirst(7)))
    }
}

// MARK: Shapes

struct Pt: Hashable, Sendable {
    var x: Double
    var y: Double
    var cg: CGPoint { CGPoint(x: x, y: y) }
}

enum SlideTheme: String, CaseIterable, Sendable {
    case light, dark, blue, green, violet, orange

    /// Background, text, muted text, accent: the web's THEME_COLORS.
    var colors: (bg: Color, fg: Color, muted: Color, accent: Color) {
        switch self {
        case .light: (Color(docHex: 0xffffff), Color(docHex: 0x161616), Color(docHex: 0x6b6b6b), Color(docHex: 0x2d7fe0))
        case .dark: (Color(docHex: 0x141518), Color(docHex: 0xf2f2f2), Color(docHex: 0xa3a3a3), Color(docHex: 0x8ec2ff))
        case .blue: (Color(docHex: 0x0c2a4b), Color(docHex: 0xf4f8ff), Color(docHex: 0xa9c1dd), Color(docHex: 0x7cc4ff))
        case .green: (Color(docHex: 0x0f2e22), Color(docHex: 0xf1faf5), Color(docHex: 0xa6c9b7), Color(docHex: 0x7fe0b0))
        case .violet: (Color(docHex: 0x24164a), Color(docHex: 0xf6f2ff), Color(docHex: 0xbdb0e3), Color(docHex: 0xc8b8ff))
        case .orange: (Color(docHex: 0xfff4e8), Color(docHex: 0x2b1700), Color(docHex: 0x8a6a4a), Color(docHex: 0xd9690f))
        }
    }
}

struct Slide: Hashable, Sendable {
    /// title, section, content, image or quote.
    var layout: String
    var title: String
    var subtitle: String?
    var bullets: [String]
    var body: String?
    var image: URL?
    var imageAlt: String?
    var notes: String?
}

struct SlidesDoc: Hashable, Sendable {
    var theme: SlideTheme
    var slides: [Slide]
}

enum SheetCell: Hashable, Sendable {
    case text(String)
    case number(Double)
    case empty

    var raw: String {
        switch self {
        case .text(let s): s
        case .number(let n): SheetFormat.plain(n)
        case .empty: ""
        }
    }

    var isFormula: Bool {
        if case .text(let s) = self { return s.trimmingCharacters(in: .whitespaces).hasPrefix("=") }
        return false
    }
}

struct SheetColumn: Hashable, Sendable {
    var name: String
    /// text, number, currency, percent or date.
    var type: String
    var numeric: Bool { type == "number" || type == "currency" || type == "percent" }
}

struct SheetDoc: Hashable, Sendable {
    var columns: [SheetColumn]
    var rows: [[SheetCell]]
    var currency: String?
}

struct ChartSeries: Hashable, Sendable {
    var name: String
    var values: [Double?]
}

struct ChartDoc: Hashable, Sendable {
    /// bar, line, area, pie or donut.
    var type: String
    var labels: [String]
    var series: [ChartSeries]
    var unit: String?
    var stacked: Bool
    var horizontal: Bool
    var xLabel: String?
    var yLabel: String?
    var caption: String?

    /// Series colours, in order (the web's CHART_COLORS).
    static let colors: [Color] = ([0x3b82f6, 0xf59e0b, 0x10b981, 0xef4444, 0x8b5cf6, 0xec4899, 0x14b8a6, 0xf97316, 0x64748b, 0x84cc16] as [UInt32]).map { Color(docHex: $0) }
    static func color(_ i: Int) -> Color { colors[i % colors.count] }
}

struct WbItem: Hashable, Sendable, Identifiable {
    var id: String
    /// note, shape, text, arrow or stroke.
    var type: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    var text: String?
    var color: String?
    var shape: String?
    var size: Double?
    var from: String?
    var to: String?
    var points: [Pt]
    var dashed: Bool
    var width: Double?

    var rect: CGRect {
        if (type == "stroke" || type == "arrow"), !points.isEmpty { return Self.bounds(points) }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    static func bounds(_ points: [Pt]) -> CGRect {
        let xs = points.map(\.x), ys = points.map(\.y)
        let x = xs.min() ?? 0, y = ys.min() ?? 0
        return CGRect(x: x, y: y, width: (xs.max() ?? 0) - x, height: (ys.max() ?? 0) - y)
    }
}

struct WhiteboardDoc: Hashable, Sendable {
    var items: [WbItem]

    /// Sticky-note fill and ink per colour (the web's WB_PALETTE).
    static func palette(_ name: String?) -> (fill: Color, ink: Color)? {
        switch name {
        case "yellow": (Color(docHex: 0xfff1a8), Color(docHex: 0xb58900))
        case "pink": (Color(docHex: 0xffd6e7), Color(docHex: 0xd6336c))
        case "blue": (Color(docHex: 0xd6e8ff), Color(docHex: 0x2d7fe0))
        case "green": (Color(docHex: 0xd8f5d0), Color(docHex: 0x2f9e44))
        case "purple": (Color(docHex: 0xe7defc), Color(docHex: 0x7048e8))
        case "orange": (Color(docHex: 0xffe2c4), Color(docHex: 0xe8590c))
        case "gray": (Color(docHex: 0xececec), Color(docHex: 0x868e96))
        case "red": (Color(docHex: 0xffd8d6), Color(docHex: 0xe03131))
        default: nil
        }
    }

    /// Where an arrow runs: edge to edge between the items it joins, or along its own points.
    func arrowPoints(_ it: WbItem, byId: [String: WbItem]) -> [CGPoint]? {
        if it.points.count >= 2, it.from == nil || it.to == nil { return it.points.map(\.cg) }
        guard let f = it.from, let t = it.to, let a = byId[f], let b = byId[t] else {
            return it.points.count >= 2 ? it.points.map(\.cg) : nil
        }
        let ra = a.rect, rb = b.rect
        let ca = CGPoint(x: ra.midX, y: ra.midY), cb = CGPoint(x: rb.midX, y: rb.midY)
        return [Self.edge(ra, from: ca, to: cb, gap: 6), Self.edge(rb, from: cb, to: ca, gap: 8)]
    }

    private static func edge(_ r: CGRect, from: CGPoint, to: CGPoint, gap: Double) -> CGPoint {
        let dx = to.x - from.x, dy = to.y - from.y
        guard dx != 0 || dy != 0 else { return from }
        let tx = dx != 0 ? r.width / 2 / abs(dx) : .infinity
        let ty = dy != 0 ? r.height / 2 / abs(dy) : .infinity
        let t = min(tx, ty)
        let len = (dx * dx + dy * dy).squareRoot()
        return CGPoint(x: from.x + dx * t + dx / len * gap, y: from.y + dy * t + dy / len * gap)
    }

    /// Everything on the board, with a margin.
    var bounds: CGRect {
        guard !items.isEmpty else { return CGRect(x: 0, y: 0, width: 800, height: 500) }
        let byId = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var r: CGRect?
        for it in items {
            var b = it.rect
            if it.type == "arrow", let pts = arrowPoints(it, byId: byId) { b = WbItem.bounds(pts.map { Pt(x: $0.x, y: $0.y) }) }
            r = r.map { $0.union(b) } ?? b
        }
        let box = r ?? .zero
        let pad = 40.0
        return CGRect(x: box.minX - pad, y: box.minY - pad, width: max(200, box.width + pad * 2), height: max(140, box.height + pad * 2))
    }
}

enum DocContent: Hashable, Sendable {
    case doc(String)
    case slides(SlidesDoc)
    case sheet(SheetDoc)
    case chart(ChartDoc)
    case whiteboard(WhiteboardDoc)
}

/// One version of a document: what a chat card shows and the viewer opens.
struct DocSnapshot: Hashable, Sendable, Identifiable {
    var artifactId: String?
    var kind: DocKind
    var title: String
    var version: Int
    var content: DocContent

    var id: String { "\(artifactId ?? title)-\(version)" }
    var displayTitle: String { title.isEmpty ? kind.label : title }

    init(artifactId: String?, kind: DocKind, title: String, version: Int, data: JSONValue?) {
        self.artifactId = artifactId
        self.kind = kind
        self.title = title
        self.version = max(1, version)
        self.content = DocParse.content(kind, data ?? .object([:]))
    }

    /// From a stored artifact ({ id, kind, title, data }).
    init?(artifact a: JSONValue) {
        guard let kind = DocKind(rawValue: a["kind"]?.string ?? "") else { return nil }
        self.init(artifactId: a["id"]?.string, kind: kind, title: a["title"]?.string ?? "", version: a["data"]?["version"]?.int ?? 1, data: a["data"])
    }

    /// From a tool call in a chat: the saved version once there's output, the arriving input
    /// while a create streams in.
    static func from(_ call: ToolCall) -> (snap: DocSnapshot?, building: Bool) {
        let out = call.state == "output-available" ? call.output : nil
        if let out, out["ok"]?.bool == true, let kind = DocKind(rawValue: out["kind"]?.string ?? ""), let document = out["document"] {
            return (DocSnapshot(artifactId: out["artifactId"]?.string, kind: kind, title: out["title"]?.string ?? "", version: out["version"]?.int ?? 1, data: document), false)
        }
        if out == nil, let kind = DocKind.forTool(call.name), let input = call.input {
            return (DocSnapshot(artifactId: nil, kind: kind, title: input["title"]?.string ?? "", version: 1, data: input), true)
        }
        return (nil, out == nil)
    }

    /// "8 slides", "2 columns · 14 rows".
    var summary: String {
        func n(_ count: Int, _ one: String) -> String { "\(count) \(one)\(count == 1 ? "" : "s")" }
        switch content {
        case .doc(let md): return n(md.split(whereSeparator: \.isWhitespace).count, "word")
        case .slides(let d): return n(d.slides.count, "slide")
        case .sheet(let s): return "\(n(s.columns.count, "column")) · \(n(s.rows.count, "row"))"
        case .chart(let c): return "\(c.type.prefix(1).uppercased())\(c.type.dropFirst()) chart · \(n(c.labels.count, "point"))"
        case .whiteboard(let w): return n(w.items.count, "item")
        }
    }

    var systemImage: String {
        switch content {
        case .doc: "doc.text"
        case .slides: "rectangle.on.rectangle.angled"
        case .sheet: "tablecells"
        case .whiteboard: "scribble.variable"
        case .chart(let c):
            switch c.type {
            case "line", "area": "chart.xyaxis.line"
            case "pie", "donut": "chart.pie"
            default: "chart.bar"
            }
        }
    }
}

// MARK: Parsing

enum DocParse {
    static func str(_ v: JSONValue?, _ max: Int = 20_000) -> String? {
        switch v {
        case .string(let s)?: String(s.prefix(max))
        case .number(let n)?: SheetFormat.plain(n)
        default: nil
        }
    }

    static func num(_ v: JSONValue?) -> Double? {
        switch v {
        case .number(let n)?: n.isFinite ? n : nil
        case .string(let s)?: Double(s.trimmingCharacters(in: .whitespaces))
        default: nil
        }
    }

    static func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }

    static func content(_ kind: DocKind, _ v: JSONValue) -> DocContent {
        switch kind {
        case .doc: .doc(str(v["markdown"], 200_000) ?? "")
        case .slides: .slides(slides(v))
        case .sheet: .sheet(sheet(v))
        case .chart: .chart(chart(v))
        case .whiteboard: .whiteboard(whiteboard(v))
        }
    }

    static func slide(_ s: JSONValue) -> Slide? {
        let title = str(s["title"], 300) ?? ""
        let bullets = s["bullets"]?.array.compactMap { str($0, 600) }.filter { !$0.isEmpty } ?? []
        let body = nonEmpty(str(s["body"], 4000))
        let image = str(s["image"], 2000).flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
        if title.isEmpty, bullets.isEmpty, body == nil, image == nil { return nil }
        let fallback = image != nil ? "image" : (!bullets.isEmpty || body != nil) ? "content" : "title"
        let layouts: Set<String> = ["title", "section", "content", "image", "quote"]
        let layout = s["layout"]?.string.flatMap { layouts.contains($0) ? $0 : nil } ?? fallback
        return Slide(layout: layout, title: title, subtitle: nonEmpty(str(s["subtitle"], 400)), bullets: bullets, body: body, image: image, imageAlt: nonEmpty(str(s["imageAlt"], 300)), notes: nonEmpty(str(s["notes"], 4000)))
    }

    static func slides(_ v: JSONValue) -> SlidesDoc {
        SlidesDoc(theme: SlideTheme(rawValue: v["theme"]?.string ?? "") ?? .light, slides: Array((v["slides"]?.array ?? []).compactMap(slide).prefix(80)))
    }

    static func cell(_ v: JSONValue) -> SheetCell {
        switch v {
        case .number(let n): n.isFinite ? .number(n) : .empty
        case .string(let s): .text(String(s.prefix(2000)))
        case .bool(let b): .text(b ? "TRUE" : "FALSE")
        default: .empty
        }
    }

    static func sheet(_ v: JSONValue) -> SheetDoc {
        let types: Set<String> = ["text", "number", "currency", "percent", "date"]
        var columns: [SheetColumn] = (v["columns"]?.array ?? []).prefix(40).map { c in
            if let s = c.string { return SheetColumn(name: String(s.prefix(120)), type: "text") }
            return SheetColumn(name: str(c["name"], 120) ?? "", type: c["type"]?.string.flatMap { types.contains($0) ? $0 : nil } ?? "text")
        }
        var rows: [[SheetCell]] = (v["rows"]?.array ?? []).prefix(1000).map { r in r.array.prefix(40).map(cell) }
        let width = max(columns.count, rows.map(\.count).max() ?? 0)
        while columns.count < width { columns.append(SheetColumn(name: SheetFormat.colName(columns.count), type: "text")) }
        rows = rows.map { $0.count < width ? $0 + Array(repeating: .empty, count: width - $0.count) : $0 }
        return SheetDoc(columns: columns, rows: rows, currency: nonEmpty(str(v["currency"], 8)))
    }

    static func chart(_ v: JSONValue) -> ChartDoc {
        var labels = (v["labels"]?.array ?? []).prefix(200).map { str($0, 120) ?? "" }
        var series: [ChartSeries] = (v["series"]?.array ?? []).prefix(12).compactMap { s in
            let values = s["values"]?.array.prefix(200).map { num($0) } ?? []
            return values.isEmpty ? nil : ChartSeries(name: str(s["name"], 120) ?? "", values: Array(values))
        }
        if series.isEmpty, let values = v["values"]?.array, !values.isEmpty {
            series = [ChartSeries(name: str(v["name"], 120) ?? "", values: values.map { num($0) })]
        }
        let n = max(labels.count, series.map(\.values.count).max() ?? 0)
        while labels.count < n { labels.append(String(labels.count + 1)) }
        let types: Set<String> = ["bar", "line", "area", "pie", "donut"]
        return ChartDoc(
            type: v["type"]?.string.flatMap { types.contains($0) ? $0 : nil } ?? "bar",
            labels: Array(labels), series: series,
            unit: nonEmpty(str(v["unit"], 16)), stacked: v["stacked"]?.bool == true, horizontal: v["horizontal"]?.bool == true,
            xLabel: nonEmpty(str(v["xLabel"], 80)), yLabel: nonEmpty(str(v["yLabel"], 80)), caption: nonEmpty(str(v["caption"], 400))
        )
    }

    static func points(_ v: JSONValue?) -> [Pt] {
        (v?.array ?? []).prefix(2000).compactMap { p in
            if case .array(let a) = p, a.count >= 2, let x = num(a[0]), let y = num(a[1]) { return Pt(x: x, y: y) }
            if let x = num(p["x"]), let y = num(p["y"]) { return Pt(x: x, y: y) }
            return nil
        }
    }

    static func whiteboard(_ v: JSONValue) -> WhiteboardDoc {
        let types: Set<String> = ["note", "shape", "text", "arrow", "stroke"]
        var seen = Set<String>()
        var items: [WbItem] = []
        for (i, o) in (v["items"]?.array ?? []).prefix(500).enumerated() {
            let pts = points(o["points"])
            let guess = o["points"] != nil ? "stroke" : (o["from"] != nil || o["to"] != nil) ? "arrow" : "note"
            let type = o["type"]?.string.flatMap { types.contains($0) ? $0 : nil } ?? guess
            let text = nonEmpty(str(o["text"], 2000))
            let size = num(o["size"])
            let defaults: (Double, Double) = type == "note" ? (180, 140) : type == "shape" ? (170, 90) : type == "text" ? (240, 40) : (0, 0)
            var w = num(o["w"]) ?? defaults.0
            if type == "text", o["w"] == nil, let text { w = min(600, Double(text.count) * (size ?? 20) * 0.55 + 10) }
            var item = WbItem(
                id: nonEmpty(str(o["id"], 60)) ?? "i\(i + 1)", type: type,
                x: num(o["x"]) ?? 0, y: num(o["y"]) ?? 0, w: max(10, w), h: max(10, num(o["h"]) ?? defaults.1),
                text: text, color: o["color"]?.string, shape: type == "shape" ? (o["shape"]?.string ?? "rect") : nil,
                size: type == "text" ? min(96, max(10, size ?? 20)) : nil,
                from: nonEmpty(str(o["from"], 60)), to: nonEmpty(str(o["to"], 60)),
                points: pts, dashed: o["dashed"]?.bool == true, width: type == "stroke" ? min(24, max(1, num(o["width"]) ?? 3)) : nil
            )
            if type == "arrow", pts.count < 2, item.from == nil || item.to == nil { continue }
            if type == "stroke", pts.count < 2 { continue }
            while seen.contains(item.id) { item.id += "-\(i)" }
            seen.insert(item.id)
            items.append(item)
        }
        return WhiteboardDoc(items: items)
    }
}

// MARK: Sheet formulas
// Columns are letters, row 1 is the header row, so the first data row is row 2 (as in Excel).
// Supports + - * / ^ &, comparisons, ranges (B2:B9, B:B) and SUM, AVERAGE, MIN, MAX, COUNT,
// COUNTA, MEDIAN, PRODUCT, ROUND, ABS, IF.

enum SheetValue: Hashable, Sendable {
    case number(Double)
    case text(String)
    case bool(Bool)
    case empty
    case error(String)
    indirect case list([SheetValue])
}

enum SheetFormat {
    static func colName(_ i: Int) -> String {
        var s = ""
        var n = i + 1
        while n > 0 {
            let r = (n - 1) % 26
            s = String(UnicodeScalar(UInt8(65 + r))) + s
            n = (n - 1) / 26
        }
        return s
    }

    static func colIndex(_ letters: String) -> Int {
        letters.uppercased().unicodeScalars.reduce(0) { $0 * 26 + Int($1.value) - 64 } - 1
    }

    /// "B3" → column 1, data row 1 (row 1 is the header: -1).
    static func parseRef(_ ref: String) -> (col: Int, row: Int)? {
        let s = ref.trimmingCharacters(in: .whitespaces).uppercased()
        let letters = s.prefix { $0.isLetter }
        let digits = s.dropFirst(letters.count)
        guard (1...3).contains(letters.count), !digits.isEmpty, digits.allSatisfy(\.isNumber), let row = Int(digits) else { return nil }
        return (colIndex(String(letters)), row - 2)
    }

    /// A plain cell's number, if it reads as one ("1,234.5", "€12", "45%").
    static func number(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !t.hasPrefix("=") else { return nil }
        let pct = t.hasSuffix("%")
        let cleaned = t.filter { !"%, $€£¥₹".contains($0) }
        guard let n = Double(cleaned), n.isFinite, cleaned.contains(where: \.isNumber) else { return nil }
        return pct ? n / 100 : n
    }

    static func plain(_ n: Double) -> String {
        n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
    }

    /// 1,234.5 with between `low` and `high` decimals (as the web formats sheets).
    static func decimal(_ n: Double, min low: Int = 0, max high: Int = 2) -> String {
        n.formatted(.number.locale(Locale(identifier: "en_US")).precision(.fractionLength(low...Swift.max(low, high))))
    }

    /// A value as the sheet shows it, by its column's type.
    static func show(_ v: SheetValue, type: String, currency: String?) -> String {
        switch v {
        case .empty: return ""
        case .error(let e): return e
        case .bool(let b): return b ? "TRUE" : "FALSE"
        case .list(let l): return l.first.map { show($0, type: type, currency: currency) } ?? ""
        case .text(let s):
            guard type != "text", type != "date", let n = number(s) else { return s }
            return show(.number(n), type: type, currency: currency)
        case .number(let n):
            switch type {
            case "currency": return "\(n < 0 ? "-" : "")\(currency ?? "$")\(decimal(abs(n), min: 2, max: 2))"
            case "percent": return "\(decimal(n * 100, max: 1))%"
            default: return decimal(n, max: abs(n) < 1 ? 4 : 2)
            }
        }
    }

    /// The sheet as CSV (computed values).
    static func csv(_ sheet: SheetDoc) -> String {
        let values = SheetEngine(sheet).evaluate()
        func esc(_ s: String) -> String { s.contains(where: { "\",\n\r".contains($0) }) ? "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\"" : s }
        func raw(_ v: SheetValue) -> String {
            switch v {
            case .number(let n): plain(n)
            case .text(let s): s
            case .bool(let b): b ? "TRUE" : "FALSE"
            case .empty: ""
            case .error(let e): e
            case .list(let l): l.first.map(raw) ?? ""
            }
        }
        var lines = [sheet.columns.map { esc($0.name) }.joined(separator: ",")]
        for row in values { lines.append(row.map { esc(raw($0)) }.joined(separator: ",")) }
        return lines.joined(separator: "\r\n")
    }
}

/// Works out a sheet's formulas. One per evaluation; not shared between threads.
final class SheetEngine {
    private let sheet: SheetDoc
    private var memo: [Int: SheetValue] = [:]
    private var visiting = Set<Int>()

    init(_ sheet: SheetDoc) { self.sheet = sheet }

    func evaluate() -> [[SheetValue]] {
        var out: [[SheetValue]] = []
        for (r, row) in sheet.rows.enumerated() {
            var values: [SheetValue] = []
            for (c, cell) in row.enumerated() {
                switch cell {
                case .number(let n): values.append(.number(n))
                case .empty: values.append(.empty)
                case .text(let s): values.append(s.trimmingCharacters(in: .whitespaces).hasPrefix("=") ? flatten(at(r, c)) : .text(s))
                }
            }
            out.append(values)
        }
        return out
    }

    private func flatten(_ v: SheetValue) -> SheetValue {
        if case .list(let l) = v { return l.first.map(flatten) ?? .empty }
        return v
    }

    private func key(_ r: Int, _ c: Int) -> Int { r * 64 + c }

    private func at(_ r: Int, _ c: Int) -> SheetValue {
        if r == -1 { return c < sheet.columns.count ? .text(sheet.columns[c].name) : .empty }
        guard r >= 0, c >= 0, r < sheet.rows.count, c < sheet.rows[r].count else { return .empty }
        let k = key(r, c)
        if let v = memo[k] { return v }
        switch sheet.rows[r][c] {
        case .number(let n): return .number(n)
        case .empty: return .empty
        case .text(let s):
            let t = s.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("=") else { return SheetFormat.number(s).map(SheetValue.number) ?? .text(s) }
            if visiting.contains(k) { return .error("#CYCLE!") }
            visiting.insert(k)
            let v = Parser(String(t.dropFirst()), engine: self).run()
            visiting.remove(k)
            memo[k] = v
            return v
        }
    }

    fileprivate func cell(_ ref: String) -> SheetValue {
        guard let p = SheetFormat.parseRef(ref) else { return .error("#REF!") }
        return at(p.row, p.col)
    }

    fileprivate func range(_ a: String, _ b: String) -> SheetValue {
        let whole = { (s: String) in (1...3).contains(s.count) && s.allSatisfy(\.isLetter) }
        var r1 = 0, r2 = sheet.rows.count - 1, c1 = 0, c2 = 0
        if whole(a) && whole(b) {
            c1 = min(SheetFormat.colIndex(a), SheetFormat.colIndex(b))
            c2 = max(SheetFormat.colIndex(a), SheetFormat.colIndex(b))
        } else {
            guard let s = SheetFormat.parseRef(a), let e = SheetFormat.parseRef(b) else { return .error("#REF!") }
            r1 = min(s.row, e.row); r2 = max(s.row, e.row)
            c1 = min(s.col, e.col); c2 = max(s.col, e.col)
        }
        var out: [SheetValue] = []
        // A range skips the cells being worked out, so a total at the bottom of a column can sum
        // the whole column (=SUM(B:B)) without counting itself.
        let lo = max(0, r1), hi = min(r2, sheet.rows.count - 1)
        if hi >= lo, c2 >= c1 {
            for r in lo...hi {
                for c in c1...c2 where !visiting.contains(key(r, c)) { out.append(at(r, c)) }
            }
        }
        return .list(out)
    }

    fileprivate static func toNumber(_ v: SheetValue) -> Result<Double, SheetError> {
        switch v {
        case .number(let n): return .success(n)
        case .bool(let b): return .success(b ? 1 : 0)
        case .empty: return .success(0)
        case .error(let e): return .failure(SheetError(code: e))
        case .text(let s):
            if s.isEmpty { return .success(0) }
            if let n = SheetFormat.number(s) { return .success(n) }
            return .failure(SheetError(code: "#VALUE!"))
        case .list(let l): return l.count == 1 ? toNumber(l[0]) : .failure(SheetError(code: "#VALUE!"))
        }
    }

    fileprivate static func text(_ v: SheetValue) -> String {
        switch v {
        case .number(let n): SheetFormat.plain(n)
        case .text(let s): s
        case .bool(let b): b ? "TRUE" : "FALSE"
        case .empty: ""
        case .error(let e): e
        case .list(let l): l.first.map(text) ?? ""
        }
    }
}

fileprivate struct SheetError: Error { let code: String }

/// A small recursive-descent parser for one formula.
fileprivate final class Parser {
    enum Tok: Equatable { case num(Double), str(String), ref(String), id(String), op(String) }

    private var toks: [Tok] = []
    private var p = 0
    private let engine: SheetEngine
    private var failed = false

    init(_ src: String, engine: SheetEngine) {
        self.engine = engine
        if let t = Self.tokenize(src) { toks = t } else { failed = true }
    }

    func run() -> SheetValue {
        if failed { return .error("#ERROR!") }
        let v = comparison()
        return p < toks.count ? .error("#ERROR!") : v
    }

    static func tokenize(_ src: String) -> [Tok]? {
        var out: [Tok] = []
        let chars = Array(src)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace { i += 1; continue }
            if c.isNumber || c == "." {
                var j = i
                while j < chars.count, chars[j].isNumber || chars[j] == "." { j += 1 }
                if j < chars.count, chars[j] == "e" || chars[j] == "E", j + 1 < chars.count, chars[j + 1].isNumber || chars[j + 1] == "-" || chars[j + 1] == "+" {
                    j += 2
                    while j < chars.count, chars[j].isNumber { j += 1 }
                }
                guard var n = Double(String(chars[i..<j])) else { return nil }
                if j < chars.count, chars[j] == "%" { n /= 100; j += 1 }
                out.append(.num(n))
                i = j
                continue
            }
            if c == "\"" {
                guard let end = chars[(i + 1)...].firstIndex(of: "\"") else { return nil }
                out.append(.str(String(chars[(i + 1)..<end])))
                i = end + 1
                continue
            }
            if c.isLetter || c == "_" || c == "$" {
                var j = i
                while j < chars.count, chars[j].isLetter || chars[j].isNumber || chars[j] == "_" || chars[j] == "." || chars[j] == "$" { j += 1 }
                let word = String(chars[i..<j])
                var k = j
                while k < chars.count, chars[k].isWhitespace { k += 1 }
                let next: Character? = k < chars.count ? chars[k] : nil
                let bare = word.replacingOccurrences(of: "$", with: "").uppercased()
                let letters = bare.prefix { $0.isLetter }
                let digits = bare.dropFirst(letters.count)
                let cellLike = (1...3).contains(letters.count) && !digits.isEmpty && digits.allSatisfy(\.isNumber) && digits.count <= 5
                let columnLike = (1...3).contains(letters.count) && digits.isEmpty
                if next != "(" && (cellLike || (columnLike && next == ":")) { out.append(.ref(bare)) } else { out.append(.id(bare)) }
                i = j
                continue
            }
            if i + 1 < chars.count {
                let two = String(chars[i...(i + 1)])
                if two == "<=" || two == ">=" || two == "<>" { out.append(.op(two)); i += 2; continue }
            }
            if "+-*/^(),:<>=&".contains(c) { out.append(.op(String(c))); i += 1; continue }
            return nil
        }
        return out
    }

    private func isOp(_ s: String) -> Bool { p < toks.count && toks[p] == .op(s) }

    private func num(_ v: SheetValue) -> Result<Double, SheetError> { SheetEngine.toNumber(v) }

    private func comparison() -> SheetValue {
        let left = sum()
        guard p < toks.count, case .op(let op) = toks[p], ["=", "<", ">", "<=", ">=", "<>"].contains(op) else { return left }
        p += 1
        let right = sum()
        if case .error = left { return left }
        if case .error = right { return right }
        if case .success(let a) = num(left), case .success(let b) = num(right), !(isText(left) || isText(right)) {
            switch op {
            case "=": return .bool(a == b)
            case "<>": return .bool(a != b)
            case "<": return .bool(a < b)
            case ">": return .bool(a > b)
            case "<=": return .bool(a <= b)
            default: return .bool(a >= b)
            }
        }
        let a = SheetEngine.text(left), b = SheetEngine.text(right)
        switch op {
        case "=": return .bool(a == b)
        case "<>": return .bool(a != b)
        case "<": return .bool(a < b)
        case ">": return .bool(a > b)
        case "<=": return .bool(a <= b)
        default: return .bool(a >= b)
        }
    }

    private func isText(_ v: SheetValue) -> Bool {
        if case .text(let s) = v { return SheetFormat.number(s) == nil }
        return false
    }

    private func sum() -> SheetValue {
        var left = term()
        while isOp("+") || isOp("-") || isOp("&") {
            guard case .op(let op) = toks[p] else { break }
            p += 1
            let right = term()
            if case .error = left { return left }
            if case .error = right { return right }
            if op == "&" { left = .text(SheetEngine.text(left) + SheetEngine.text(right)); continue }
            switch (num(left), num(right)) {
            case (.success(let a), .success(let b)): left = .number(op == "+" ? a + b : a - b)
            case (.failure(let e), _), (_, .failure(let e)): return .error(e.code)
            }
        }
        return left
    }

    private func term() -> SheetValue {
        var left = power()
        while isOp("*") || isOp("/") {
            guard case .op(let op) = toks[p] else { break }
            p += 1
            let right = power()
            switch (num(left), num(right)) {
            case (.success(let a), .success(let b)):
                if op == "/" && b == 0 { return .error("#DIV/0!") }
                left = .number(op == "*" ? a * b : a / b)
            case (.failure(let e), _), (_, .failure(let e)): return .error(e.code)
            }
        }
        return left
    }

    private func power() -> SheetValue {
        var left = primary()
        while isOp("^") {
            p += 1
            let right = primary()
            switch (num(left), num(right)) {
            case (.success(let a), .success(let b)): left = .number(pow(a, b))
            case (.failure(let e), _), (_, .failure(let e)): return .error(e.code)
            }
        }
        return left
    }

    private func primary() -> SheetValue {
        guard p < toks.count else { return .error("#ERROR!") }
        let tok = toks[p]
        p += 1
        switch tok {
        case .num(let n): return .number(n)
        case .str(let s): return .text(s)
        case .op("("):
            let v = comparison()
            guard isOp(")") else { return .error("#ERROR!") }
            p += 1
            return v
        case .op("-"), .op("+"):
            let v = power()
            switch num(v) {
            case .success(let n): return .number(tok == .op("-") ? -n : n)
            case .failure(let e): return .error(e.code)
            }
        case .ref(let r):
            if isOp(":") {
                p += 1
                guard p < toks.count else { return .error("#REF!") }
                let end = toks[p]
                p += 1
                switch end {
                case .ref(let e), .id(let e): return engine.range(r, e)
                default: return .error("#REF!")
                }
            }
            return engine.cell(r)
        case .id(let name):
            if name == "TRUE" { return .bool(true) }
            if name == "FALSE" { return .bool(false) }
            guard isOp("(") else { return .error("#NAME?") }
            p += 1
            var args: [SheetValue] = []
            if !isOp(")") {
                while true {
                    args.append(comparison())
                    if isOp(",") { p += 1; continue }
                    break
                }
            }
            guard isOp(")") else { return .error("#ERROR!") }
            p += 1
            return call(name, args)
        default:
            return .error("#ERROR!")
        }
    }

    private func flat(_ args: [SheetValue]) -> [SheetValue] {
        args.flatMap { v -> [SheetValue] in if case .list(let l) = v { return flat(l) } else { return [v] } }
    }

    private func numbers(_ args: [SheetValue]) -> Result<[Double], SheetError> {
        var out: [Double] = []
        for v in flat(args) {
            switch v {
            case .error(let e): return .failure(SheetError(code: e))
            case .number(let n): out.append(n)
            case .bool(let b): out.append(b ? 1 : 0)
            default: continue
            }
        }
        return .success(out)
    }

    private func call(_ name: String, _ args: [SheetValue]) -> SheetValue {
        func with(_ f: ([Double]) -> SheetValue) -> SheetValue {
            switch numbers(args) {
            case .success(let n): return f(n)
            case .failure(let e): return .error(e.code)
            }
        }
        switch name {
        case "SUM": return with { .number($0.reduce(0, +)) }
        case "AVERAGE", "AVG", "MEAN": return with { $0.isEmpty ? .error("#DIV/0!") : .number($0.reduce(0, +) / Double($0.count)) }
        case "MIN": return with { .number($0.min() ?? 0) }
        case "MAX": return with { .number($0.max() ?? 0) }
        case "COUNT": return with { .number(Double($0.count)) }
        case "COUNTA": return .number(Double(flat(args).filter { if case .empty = $0 { return false }; if case .text("") = $0 { return false }; return true }.count))
        case "PRODUCT": return with { .number($0.reduce(1, *)) }
        case "MEDIAN":
            return with { n in
                guard !n.isEmpty else { return .error("#NUM!") }
                let s = n.sorted(), m = s.count / 2
                return .number(s.count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2)
            }
        case "ROUND":
            switch (num(args.first ?? .number(0)), num(args.count > 1 ? args[1] : .number(0))) {
            case (.success(let x), .success(let d)):
                let f = pow(10, d.rounded(.towardZero))
                return .number((x * f).rounded() / f)
            case (.failure(let e), _), (_, .failure(let e)): return .error(e.code)
            }
        case "ABS":
            switch num(args.first ?? .number(0)) {
            case .success(let x): return .number(abs(x))
            case .failure(let e): return .error(e.code)
            }
        case "IF":
            let c = args.first ?? .bool(false)
            if case .error = c { return c }
            let yes: Bool = {
                switch c {
                case .number(let n): n != 0
                case .text(let s): !s.isEmpty
                case .bool(let b): b
                default: false
                }
            }()
            if yes { return args.count > 1 ? args[1] : .bool(true) }
            return args.count > 2 ? args[2] : .bool(false)
        default:
            return .error("#NAME?")
        }
    }
}

// MARK: Colours

extension Color {
    /// 0xRRGGBB.
    init(docHex v: UInt32) {
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
