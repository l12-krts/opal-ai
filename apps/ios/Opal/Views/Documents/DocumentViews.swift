import Charts
import SwiftUI

// How each kind of document looks: slides, sheets, charts and whiteboards (docs use the chat's
// MarkdownView). The same layouts as the web (components/documents/views.tsx).

// MARK: Slides

/// One 16:9 slide. Sizes are in hundredths of its width, so a thumbnail and the full-screen
/// slide read the same.
struct SlideView: View {
    let slide: Slide
    let theme: SlideTheme
    var index: Int?
    var total: Int?

    var body: some View {
        let c = theme.colors
        Color.clear
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                GeometryReader { g in
                    let u = g.size.width / 100
                    content(u: u, fg: c.fg, muted: c.muted, accent: c.accent)
                        .frame(width: g.size.width, height: g.size.height)
                        .overlay(alignment: .bottomTrailing) {
                            if let index, total != nil, slide.layout != "title" {
                                Text("\(index + 1)")
                                    .font(.system(size: 1.4 * u).monospacedDigit())
                                    .foregroundStyle(c.muted)
                                    .padding(.trailing, 3 * u)
                                    .padding(.bottom, 2.2 * u)
                            }
                        }
                }
            }
            .background(c.bg)
            .clipped()
            .environment(\.colorScheme, theme == .light || theme == .orange ? .light : .dark)
            .accessibilityElement(children: .combine)
    }

    private func text(_ s: String) -> Text { Text(MarkdownBlock.inline(s)) }

    @ViewBuilder private func content(u: CGFloat, fg: Color, muted: Color, accent: Color) -> some View {
        switch slide.layout {
        case "title":
            VStack(spacing: 0) {
                Capsule().fill(accent).frame(width: 6 * u, height: 0.5 * u).padding(.bottom, 3 * u)
                text(slide.title)
                    .font(.system(size: 5.6 * u, weight: .semibold))
                    .foregroundStyle(fg)
                if let s = slide.subtitle {
                    text(s).font(.system(size: 2.3 * u)).foregroundStyle(muted).padding(.top, 2.2 * u)
                }
            }
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.5)
            .padding(.horizontal, 8 * u)
        case "section":
            VStack(alignment: .leading, spacing: 0) {
                if let index {
                    Text(String(format: "%02d", index + 1))
                        .font(.system(size: 2 * u, weight: .semibold))
                        .tracking(0.16 * u)
                        .foregroundStyle(accent)
                        .padding(.bottom, 1.4 * u)
                }
                text(slide.title).font(.system(size: 5 * u, weight: .semibold)).foregroundStyle(fg)
                if let s = slide.subtitle {
                    text(s).font(.system(size: 2.2 * u)).foregroundStyle(muted).padding(.top, 1.8 * u)
                }
            }
            .minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 9 * u)
        case "quote":
            VStack(alignment: .leading, spacing: 0) {
                Text("\u{201C}").font(.system(size: 12 * u, design: .serif)).foregroundStyle(accent).frame(height: 6 * u, alignment: .top)
                text(slide.body ?? slide.title)
                    .font(.system(size: 3.6 * u, weight: .medium))
                    .foregroundStyle(fg)
                    .padding(.top, 1 * u)
                if let who = slide.subtitle ?? (slide.body != nil ? slide.title : nil), !who.isEmpty {
                    text(who).font(.system(size: 2 * u)).foregroundStyle(muted).padding(.top, 2.4 * u)
                }
            }
            .minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 11 * u)
        default:
            VStack(alignment: .leading, spacing: 0) {
                text(slide.title).font(.system(size: 3.5 * u, weight: .semibold)).foregroundStyle(fg).lineLimit(2)
                if let s = slide.subtitle {
                    text(s).font(.system(size: 1.9 * u)).foregroundStyle(muted).padding(.top, 0.8 * u).lineLimit(2)
                }
                HStack(alignment: .top, spacing: 4 * u) {
                    VStack(alignment: .leading, spacing: 1.3 * u) {
                        ForEach(Array(slide.bullets.enumerated()), id: \.offset) { _, b in
                            HStack(alignment: .firstTextBaseline, spacing: 1.6 * u) {
                                Circle().fill(accent).frame(width: 0.9 * u, height: 0.9 * u).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 0.2 * u }
                                text(b).font(.system(size: 2.15 * u)).foregroundStyle(fg)
                            }
                        }
                        if let body = slide.body {
                            ForEach(Array(body.components(separatedBy: "\n\n").enumerated()), id: \.offset) { _, para in
                                text(para.replacingOccurrences(of: "\n- ", with: "\n• ").replacingOccurrences(of: "^- ", with: "• ", options: .regularExpression))
                                    .font(.system(size: 2.15 * u))
                                    .foregroundStyle(fg)
                            }
                        }
                    }
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if slide.layout == "image", let url = slide.image {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFill()
                        } placeholder: {
                            muted.opacity(0.15)
                        }
                        .frame(width: 38 * u)
                        .frame(maxHeight: .infinity)
                        .clipShape(.rect(cornerRadius: 1.4 * u, style: .continuous))
                        .accessibilityLabel(slide.imageAlt ?? "")
                    }
                }
                .padding(.top, 3 * u)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .padding(.horizontal, 6.5 * u)
            .padding(.top, 5.5 * u)
            .padding(.bottom, 5 * u)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: Sheets

/// A sheet's grid: column letters and row numbers, values worked out and formatted by column.
struct SheetGridView: View {
    let sheet: SheetDoc
    var compact = false
    var maxRows: Int?
    var selected: (row: Int, col: Int)?
    var onSelect: ((Int, Int) -> Void)?

    private let values: [[SheetValue]]
    private let widths: [CGFloat]

    init(sheet: SheetDoc, compact: Bool = false, maxRows: Int? = nil, selected: (row: Int, col: Int)? = nil, onSelect: ((Int, Int) -> Void)? = nil) {
        self.sheet = sheet
        self.compact = compact
        self.maxRows = maxRows
        self.selected = selected
        self.onSelect = onSelect
        let values = SheetEngine(sheet).evaluate()
        self.values = maxRows.map { Array(values.prefix($0)) } ?? values
        let per: CGFloat = compact ? 7 : 7.8
        self.widths = sheet.columns.enumerated().map { c, col in
            let longest = values.prefix(200).map { SheetFormat.show($0.indices.contains(c) ? $0[c] : .empty, type: col.type, currency: sheet.currency).count }.max() ?? 0
            return min(240, max(compact ? 52 : 64, CGFloat(max(longest, col.name.count)) * per + 24))
        }
    }

    private var rowH: CGFloat { compact ? 28 : 34 }
    private var font: CGFloat { compact ? 12.5 : 14 }

    var body: some View {
        if compact {
            VStack(alignment: .leading, spacing: 0) {
                header
                ForEach(values.indices, id: \.self) { r in row(r) }
            }
        } else {
            ScrollView(.horizontal) {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            ForEach(values.indices, id: \.self) { r in row(r) }
                        } header: {
                            VStack(spacing: 0) {
                                letters
                                header
                            }
                        }
                    }
                }
            }
        }
    }

    private var letters: some View {
        HStack(spacing: 0) {
            Text("").frame(width: 40, height: 24).background(Color.wash)
            ForEach(sheet.columns.indices, id: \.self) { c in
                Text(SheetFormat.colName(c))
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .frame(width: widths[c], height: 24)
                    .background(Color.wash)
                    .overlay(alignment: .trailing) { Rectangle().fill(Color.primary.opacity(0.07)).frame(width: 1) }
            }
        }
        .background(Color.canvas)
    }

    private var header: some View {
        HStack(spacing: 0) {
            if !compact {
                Text("1").font(.system(size: 11).monospacedDigit()).foregroundStyle(.tertiary).frame(width: 40, height: rowH).background(Color.wash)
            }
            ForEach(Array(sheet.columns.enumerated()), id: \.offset) { c, col in
                Text(col.name)
                    .font(.system(size: font, weight: .semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .frame(width: widths[c], height: rowH, alignment: col.numeric ? .trailing : .leading)
                    .overlay(alignment: .trailing) { if !compact { Rectangle().fill(Color.primary.opacity(0.07)).frame(width: 1) } }
            }
        }
        .background(Color.canvas)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.14)).frame(height: 1) }
    }

    private func row(_ r: Int) -> some View {
        HStack(spacing: 0) {
            if !compact {
                Text("\(r + 2)").font(.system(size: 11).monospacedDigit()).foregroundStyle(.tertiary).frame(width: 40, height: rowH).background(Color.wash)
            }
            ForEach(Array(sheet.columns.enumerated()), id: \.offset) { c, col in
                let v = values[r].indices.contains(c) ? values[r][c] : .empty
                let isError: Bool = { if case .error = v { return true } else { return false } }()
                let numeric: Bool = { if case .number = v { return true } else { return col.numeric } }()
                let formula = sheet.rows[r].indices.contains(c) && sheet.rows[r][c].isFormula
                let isSelected = selected?.row == r && selected?.col == c
                Text(SheetFormat.show(v, type: col.type, currency: sheet.currency))
                    .font(.system(size: font).monospacedDigit())
                    .foregroundStyle(isError ? Color.danger : .primary)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .frame(width: widths[c], height: rowH, alignment: numeric ? .trailing : .leading)
                    .background(formula && !compact ? Color.primary.opacity(0.04) : .clear)
                    .overlay { if isSelected { Rectangle().strokeBorder(Color.accentColor, lineWidth: 2) } }
                    .overlay(alignment: .trailing) { if !compact { Rectangle().fill(Color.primary.opacity(0.07)).frame(width: 1) } }
                    .contentShape(.rect)
                    .onTapGesture { onSelect?(r, c) }
            }
        }
        .background(compact && r % 2 == 1 ? Color.primary.opacity(0.025) : .clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 1) }
    }
}

// MARK: Charts

/// A chart, drawn with Swift Charts.
struct ChartDocView: View {
    let chart: ChartDoc
    var compact = false

    private struct Point: Identifiable {
        let id: Int
        let label: String
        let series: String
        let value: Double
    }

    /// Labels made unique (a repeated label would merge two bars).
    private var labels: [String] {
        var seen: [String: Int] = [:]
        return chart.labels.map { l in
            let n = seen[l, default: 0]
            seen[l] = n + 1
            return n == 0 ? l : l + String(repeating: "\u{200B}", count: n)
        }
    }

    private var names: [String] {
        var seen = Set<String>()
        return chart.series.enumerated().map { i, s in
            var n = s.name.isEmpty ? "Series \(i + 1)" : s.name
            while seen.contains(n) { n += " " }
            seen.insert(n)
            return n
        }
    }

    private var points: [Point] {
        let labels = labels, names = names
        var out: [Point] = []
        for (si, s) in chart.series.enumerated() {
            for (i, v) in s.values.enumerated() where i < labels.count {
                if let v { out.append(Point(id: si * 1000 + i, label: labels[i], series: names[si], value: v)) }
            }
        }
        return out
    }

    var body: some View {
        if chart.type == "pie" || chart.type == "donut" { pie } else { cartesian }
    }

    private var unit: String { chart.unit.map { $0.count <= 2 ? $0 : "" } ?? "" }

    private var cartesian: some View {
        let names = names
        let grouped = !chart.stacked && names.count > 1
        return Chart(points) { p in
            if chart.type == "line" {
                LineMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbol(.circle)
                    .symbolSize(compact ? 14 : 28)
                    .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
            } else if chart.type == "area" {
                AreaMark(x: .value("Label", p.label), y: .value("Value", p.value), stacking: chart.stacked ? .standard : .unstacked)
                    .foregroundStyle(by: .value("Series", p.series))
                    .opacity(chart.stacked ? 0.75 : 0.35)
            } else if chart.horizontal {
                if grouped {
                    BarMark(x: .value("Value", p.value), y: .value("Label", p.label))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series))
                        .cornerRadius(3)
                } else {
                    BarMark(x: .value("Value", p.value), y: .value("Label", p.label))
                        .foregroundStyle(by: .value("Series", p.series))
                        .cornerRadius(3)
                }
            } else if grouped {
                BarMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .position(by: .value("Series", p.series))
                    .cornerRadius(3)
            } else {
                BarMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .cornerRadius(3)
            }
        }
        .chartForegroundStyleScale(domain: names, range: names.indices.map { ChartDoc.color($0) })
        .chartLegend(names.count > 1 ? .visible : .hidden)
        .modifier(AxisTitles(
            x: compact ? nil : chart.horizontal ? chart.yLabel : chart.xLabel,
            y: compact ? nil : chart.horizontal ? chart.xLabel : chart.yLabel
        ))
        .chartYAxis {
            AxisMarks { v in
                AxisGridLine()
                AxisValueLabel {
                    if let d = v.as(Double.self) { Text(Self.short(d) + unit) } else if let s = v.as(String.self) { Text(s) }
                }
            }
        }
        .font(.system(size: compact ? 10 : 12))
    }

    private struct Slice: Identifiable {
        let id: Int
        let label: String
        let value: Double
    }

    private var pie: some View {
        let labels = labels
        let values = (chart.series.first?.values ?? []).map { max(0, $0 ?? 0) }
        let slices = labels.indices.map { Slice(id: $0, label: labels[$0], value: $0 < values.count ? values[$0] : 0) }.filter { $0.value > 0 }
        let total = max(1e-9, slices.map(\.value).reduce(0, +))
        return Chart(slices) { s in
            SectorMark(angle: .value("Value", s.value), innerRadius: .ratio(chart.type == "donut" ? 0.58 : 0), angularInset: 1.2)
                .foregroundStyle(by: .value("Label", s.label))
                .cornerRadius(3)
                .annotation(position: .overlay) {
                    if !compact, s.value / total >= 0.06 {
                        Text("\(Int((s.value / total * 100).rounded()))%")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
        }
        .chartForegroundStyleScale(domain: labels, range: labels.indices.map { ChartDoc.color($0) })
        .chartLegend(position: compact ? .trailing : .bottom, alignment: .center)
        .font(.system(size: compact ? 10 : 12))
    }

    static func short(_ v: Double) -> String {
        let a = abs(v)
        if a >= 1e9 { return SheetFormat.decimal(v / 1e9, max: 1) + "B" }
        if a >= 1e6 { return SheetFormat.decimal(v / 1e6, max: 1) + "M" }
        if a >= 1e4 { return SheetFormat.decimal(v / 1e3, max: 1) + "k" }
        return SheetFormat.decimal(v, max: 2)
    }
}

/// Axis titles, only when there are any (a compact chart in a card has none).
private struct AxisTitles: ViewModifier {
    let x: String?
    let y: String?

    @ViewBuilder func body(content: Content) -> some View {
        switch (x, y) {
        case (let x?, let y?): content.chartXAxisLabel(x).chartYAxisLabel(y)
        case (let x?, nil): content.chartXAxisLabel(x)
        case (nil, let y?): content.chartYAxisLabel(y)
        case (nil, nil): content
        }
    }
}

// MARK: Whiteboards

/// The board's drawing: board point `origin` at the top-left, `scale` points per board unit.
/// Items are laid out at the zoomed size (not scaled afterwards), so text stays sharp.
struct WhiteboardView: View {
    let board: WhiteboardDoc
    var origin: CGPoint
    var scale: CGFloat
    var dots = false
    @Environment(\.colorScheme) private var scheme

    private static let noteInk = Color(docHex: 0x1f1f1f)

    var body: some View {
        let ink = scheme == .dark ? Color(white: 0.93) : Color(white: 0.11)
        let k = scale
        let byId = Dictionary(board.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        ZStack(alignment: .topLeading) {
            if dots {
                Canvas { ctx, size in
                    let step = 22 * k
                    guard step >= 7 else { return }
                    let x0 = (-origin.x * k).truncatingRemainder(dividingBy: step)
                    let y0 = (-origin.y * k).truncatingRemainder(dividingBy: step)
                    var x = x0 < 0 ? x0 + step : x0
                    while x < size.width {
                        var y = y0 < 0 ? y0 + step : y0
                        while y < size.height {
                            ctx.fill(Path(ellipseIn: CGRect(x: x - 0.75, y: y - 0.75, width: 1.5, height: 1.5)), with: .color(ink.opacity(0.16)))
                            y += step
                        }
                        x += step
                    }
                }
            }
            // Strokes and arrows, under everything else.
            Canvas { ctx, _ in
                func pt(_ p: CGPoint) -> CGPoint { CGPoint(x: (p.x - origin.x) * k, y: (p.y - origin.y) * k) }
                for it in board.items where it.type == "stroke" {
                    let color = WhiteboardDoc.palette(it.color)?.ink ?? ink
                    var path = Path()
                    let pts = it.points.map { pt($0.cg) }
                    guard let first = pts.first else { continue }
                    path.move(to: first)
                    if pts.count > 2 {
                        for i in 1..<(pts.count - 1) {
                            let mid = CGPoint(x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2)
                            path.addQuadCurve(to: mid, control: pts[i])
                        }
                    }
                    path.addLine(to: pts[pts.count - 1])
                    ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: (it.width ?? 3) * k, lineCap: .round, lineJoin: .round))
                }
                for it in board.items where it.type == "arrow" {
                    guard let raw = board.arrowPoints(it, byId: byId), raw.count >= 2 else { continue }
                    let pts = raw.map(pt)
                    let color = WhiteboardDoc.palette(it.color)?.ink ?? ink.opacity(0.7)
                    var path = Path()
                    path.addLines(pts)
                    ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 2 * k, lineCap: .round, lineJoin: .round, dash: it.dashed ? [7 * k, 6 * k] : []))
                    // The head.
                    let a = pts[pts.count - 2], b = pts[pts.count - 1]
                    let angle = atan2(b.y - a.y, b.x - a.x)
                    let len = 11 * k, spread = 0.45
                    var head = Path()
                    head.move(to: b)
                    head.addLine(to: CGPoint(x: b.x - len * cos(angle - spread), y: b.y - len * sin(angle - spread)))
                    head.addLine(to: CGPoint(x: b.x - len * cos(angle + spread), y: b.y - len * sin(angle + spread)))
                    head.closeSubpath()
                    ctx.fill(head, with: .color(color))
                    if let label = it.text, !label.isEmpty {
                        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10 * k)
                        ctx.draw(Text(label).font(.system(size: 13 * k)).foregroundStyle(ink.opacity(0.8)), at: mid, anchor: .center)
                    }
                }
            }
            ForEach(board.items.filter { $0.type == "shape" || $0.type == "note" || $0.type == "text" }) { it in
                item(it, ink: ink)
                    .frame(width: CGFloat(it.w) * k, height: it.type == "text" ? nil : CGFloat(it.h) * k, alignment: .topLeading)
                    .offset(x: (CGFloat(it.x) - origin.x) * k, y: (CGFloat(it.y) - origin.y) * k)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
    }

    @ViewBuilder private func item(_ it: WbItem, ink: Color) -> some View {
        let k = scale
        let pal = WhiteboardDoc.palette(it.color)
        switch it.type {
        case "note":
            let p = pal ?? WhiteboardDoc.palette("yellow")!
            Text(it.text ?? "")
                .font(.system(size: 17 * k))
                .foregroundStyle(Self.noteInk)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.55)
                .padding(.horizontal, 12 * k)
                .padding(.vertical, 10 * k)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(p.fill, in: .rect(cornerRadius: 6 * k))
                .shadow(color: .black.opacity(0.1), radius: 2 * k, y: 3 * k)
        case "shape":
            let stroke = pal?.ink ?? ink
            let fill = pal?.fill ?? .clear
            let inset: CGFloat = it.shape == "diamond" ? 0.22 : it.shape == "ellipse" ? 0.13 : 0.05
            Text(it.text ?? "")
                .font(.system(size: 16 * k))
                .foregroundStyle(pal != nil ? Self.noteInk : ink)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.55)
                .padding(.horizontal, it.w * k * inset + 4 * k)
                .padding(.vertical, it.h * k * inset)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    switch it.shape {
                    case "ellipse": Ellipse().fill(fill).overlay { Ellipse().strokeBorder(stroke, lineWidth: 2 * k) }
                    case "diamond": Diamond().fill(fill).overlay { Diamond().stroke(stroke, style: StrokeStyle(lineWidth: 2 * k, lineJoin: .round)) }
                    default: RoundedRectangle(cornerRadius: 12 * k, style: .continuous).fill(fill).overlay { RoundedRectangle(cornerRadius: 12 * k, style: .continuous).strokeBorder(stroke, lineWidth: 2 * k) }
                    }
                }
        default:
            let size = it.size ?? 20
            Text(it.text ?? "")
                .font(.system(size: size * k, weight: size >= 28 ? .semibold : .regular))
                .foregroundStyle(pal?.ink ?? ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct Diamond: Shape {
    func path(in r: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: r.midX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
            p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX, y: r.midY))
            p.closeSubpath()
        }
    }
}

/// The whole board fitted into the space it's given (cards, the documents list, exports).
struct WhiteboardFit: View {
    let board: WhiteboardDoc
    var dots = false
    var maxScale: CGFloat = 1.4

    var body: some View {
        GeometryReader { g in
            let b = board.bounds
            let k = min(g.size.width / b.width, g.size.height / b.height, maxScale)
            let origin = CGPoint(x: b.midX - g.size.width / 2 / k, y: b.midY - g.size.height / 2 / k)
            WhiteboardView(board: board, origin: origin, scale: k, dots: dots)
        }
    }
}

/// The board you can pan (drag) and zoom (pinch, double tap to fit).
struct WhiteboardCanvas: View {
    let board: WhiteboardDoc
    @State private var zoom: CGFloat = 1
    /// How far the view has moved from centred, in board units.
    @State private var pan: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var drag: CGSize = .zero

    var body: some View {
        GeometryReader { g in
            let b = board.bounds
            let fit = min(g.size.width / b.width, g.size.height / b.height, 1.4)
            let k = max(0.05, fit * zoom * pinch)
            let centre = CGPoint(x: b.midX + pan.width - drag.width / k, y: b.midY + pan.height - drag.height / k)
            let origin = CGPoint(x: centre.x - g.size.width / 2 / k, y: centre.y - g.size.height / 2 / k)
            WhiteboardView(board: board, origin: origin, scale: k, dots: true)
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 1)
                        .updating($drag) { v, s, _ in s = v.translation }
                        .onEnded { v in pan = CGSize(width: pan.width - v.translation.width / k, height: pan.height - v.translation.height / k) }
                        .simultaneously(with:
                            MagnifyGesture()
                                .updating($pinch) { v, s, _ in s = v.magnification }
                                .onEnded { v in zoom = min(8, max(0.15, zoom * v.magnification)) }
                        )
                )
                .onTapGesture(count: 2) {
                    withAnimation(Motion.morph) { zoom = 1; pan = .zero }
                }
                .overlay(alignment: .bottomTrailing) {
                    HStack(spacing: 2) {
                        zoomButton("minus.magnifyingglass", "Zoom out") { zoom = max(0.15, zoom / 1.3) }
                        Text("\(Int((k * 100).rounded()))%")
                            .font(.system(size: 12.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 44)
                        zoomButton("plus.magnifyingglass", "Zoom in") { zoom = min(8, zoom * 1.3) }
                        zoomButton("arrow.up.left.and.arrow.down.right", "Fit to screen") { zoom = 1; pan = .zero }
                    }
                    .padding(4)
                    .opalGlass(in: Capsule())
                    .padding(16)
                }
        }
        .accessibilityLabel(board.items.compactMap(\.text).joined(separator: ", "))
    }

    private func zoomButton(_ image: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.morph) { action() }
        } label: {
            Image(systemName: image).font(.system(size: 14, weight: .medium)).frame(width: 36, height: 36).contentShape(Circle())
        }
        .buttonStyle(PressableStyle())
        .foregroundStyle(.primary)
        .accessibilityLabel(label)
    }
}

// MARK: Preview

/// A glance at a document, for chat cards and the Documents list. Not interactive.
struct DocPreview: View {
    let snap: DocSnapshot
    var height: CGFloat

    var body: some View {
        // A canvas exactly the size it's given, with the document drawn over it from the top
        // left and clipped: a wide deck or sheet never makes the card (or the chat) wider, and a
        // long doc shows its beginning.
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background { if case .slides = snap.content { Color.wash.opacity(0.5) } }
            .overlay(alignment: .topLeading) { content }
            .overlay(alignment: .bottom) {
                if case .doc = snap.content {
                    LinearGradient(colors: [Color.canvas.opacity(0), Color.canvas], startPoint: .top, endPoint: .bottom).frame(height: 56)
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    @ViewBuilder private var content: some View {
        switch snap.content {
        case .doc(let md):
            MarkdownView(text: String(md.prefix(1400)), size: 13)
                .padding(.horizontal, 16)
                .padding(.top, 14)
        case .slides(let d):
            HStack(spacing: 10) {
                ForEach(Array(d.slides.prefix(4).enumerated()), id: \.offset) { i, s in
                    SlideView(slide: s, theme: d.theme, index: i, total: d.slides.count)
                        .frame(width: (height - 24) * 16 / 9, height: height - 24)
                        .clipShape(.rect(cornerRadius: 6, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.primary.opacity(0.1)) }
                }
            }
            .padding(12)
            .fixedSize()
        case .sheet(let s):
            SheetGridView(sheet: s, compact: true, maxRows: max(3, Int((height - 30) / 28)))
                .fixedSize()
        case .chart(let c):
            ChartDocView(chart: c, compact: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(height: height)
        case .whiteboard(let w):
            WhiteboardFit(board: w, dots: true)
                .padding(8)
                .frame(height: height)
        }
    }
}
