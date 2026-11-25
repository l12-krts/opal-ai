import SwiftUI
import UIKit

// Opal Handwriting on iOS: the same renderer as the web (lib/handwriting/render.ts), drawn with
// Core Graphics. Markdown is laid out on A4 and every character is drawn with one of the writer's
// own glyphs, varying size, slant, baseline and ink, so no two letters are alike. Tables and
// charts get hand-ruled lines.

enum HandwritingPaper: String, CaseIterable, Identifiable, Sendable {
    case lined, grid, blank
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum HandwritingInk: String, CaseIterable, Identifiable, Sendable {
    case blue, darkblue, black
    var id: String { rawValue }
    var label: String { self == .darkblue ? "Navy" : rawValue.capitalized }
    var color: UIColor {
        switch self {
        case .blue: UIColor(rgb: 0x1f3d99)
        case .black: UIColor(rgb: 0x1e1e22)
        case .darkblue: UIColor(rgb: 0x14234f)
        }
    }
}

/// A saved handwriting answer (GET /api/artifacts/:id).
struct HandwritingDoc: Sendable {
    let title: String
    let markdown: String
    let profileId: String?
    let paper: HandwritingPaper
    let ink: HandwritingInk

    static func load(_ id: String, api: APIClient) async throws -> HandwritingDoc {
        struct Res: Decodable { let artifact: JSONValue }
        let a = try await api.send("/api/artifacts/\(id)", as: Res.self).artifact
        let d = a["data"]
        return HandwritingDoc(
            title: a["title"]?.string ?? "Handwriting",
            markdown: d?["markdown"]?.string ?? "",
            profileId: d?["profileId"]?.string,
            paper: HandwritingPaper(rawValue: d?["paper"]?.string ?? "") ?? .lined,
            ink: HandwritingInk(rawValue: d?["ink"]?.string ?? "") ?? .blue
        )
    }
}

// MARK: Glyph atlas

/// One of the writer's letters, cut from their sheet. Sizes are in em.
struct HandGlyph: @unchecked Sendable {
    let char: String
    let variant: Int
    let width: CGFloat
    let height: CGFloat
    let baseline: CGFloat
    let advance: CGFloat
    let image: UIImage
}

struct HandAtlas: @unchecked Sendable {
    let glyphs: [String: [HandGlyph]]
    /// Typical cap height above the baseline, in em.
    let capHeight: CGFloat

    func lookup(_ ch: Character) -> [HandGlyph]? {
        if let g = glyphs[String(ch)], !g.isEmpty { return g }
        // "ά" falls back to "α" when the accented form wasn't written.
        if let base = String(ch).decomposedStringWithCanonicalMapping.first, let g = glyphs[String(base)], !g.isEmpty { return g }
        return nil
    }

    static func from(_ json: [JSONValue]) -> HandAtlas {
        var map: [String: [HandGlyph]] = [:]
        for g in json {
            guard let char = g["char"]?.string, let png = g["png"]?.string,
                  let comma = png.firstIndex(of: ","), let data = Data(base64Encoded: String(png[png.index(after: comma)...])),
                  let image = UIImage(data: data) else { continue }
            map[char, default: []].append(HandGlyph(
                char: char, variant: g["variant"]?.int ?? 0,
                width: CGFloat(g["width"]?.number ?? 0.5), height: CGFloat(g["height"]?.number ?? 0.7),
                baseline: CGFloat(g["baseline"]?.number ?? 0.55), advance: CGFloat(g["advance"]?.number ?? 0.5),
                image: image
            ))
        }
        let caps = "HEΑΒΤΚ".flatMap { map[String($0)] ?? [] }.map(\.baseline).sorted()
        return HandAtlas(glyphs: map, capHeight: caps.isEmpty ? 0.55 : caps[caps.count / 2])
    }
}

@MainActor
enum HandAtlasCache {
    private static var cache: [String: HandAtlas] = [:]

    static func load(_ profileId: String, api: APIClient) async -> HandAtlas? {
        if let hit = cache[profileId] { return hit }
        struct Res: Decodable { let glyphs: [JSONValue] }
        guard let res = try? await api.send("/api/handwriting/profiles/\(profileId)", as: Res.self), !res.glyphs.isEmpty else { return nil }
        let glyphs = res.glyphs
        let atlas = await Task.detached(priority: .userInitiated) { HandAtlas.from(glyphs) }.value
        cache[profileId] = atlas
        return atlas
    }
}

// MARK: Renderer

struct HandwritingRenderer {
    static let pageSize = CGSize(width: 794, height: 1123)
    private static let line: CGFloat = 33
    private static let top: CGFloat = 96
    private static let left: CGFloat = 84
    private static let right: CGFloat = 56
    private static let bottom: CGFloat = 72

    /// Renders on a background thread. Pages come back as images, at most 12.
    static func render(_ markdown: String, atlas: HandAtlas?, paper: HandwritingPaper, ink: HandwritingInk, scale: CGFloat = 2) async -> [UIImage] {
        await Task.detached(priority: .userInitiated) {
            let w = Writer(atlas: atlas, paper: paper, ink: ink.color, seed: hash(markdown), scale: scale)
            for block in MarkdownBlock.parse(String(markdown.prefix(20000))) {
                w.block(block, depth: 0)
                if w.pages.count >= 12 { break }
            }
            return w.finish()
        }.value
    }

    static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 2166136261
        for c in s.utf16 { h = (h ^ UInt32(c)) &* 16777619 }
        return h
    }

    private struct Run { var text: String; var bold = false; var italic = false }

    private final class Writer {
        let atlas: HandAtlas?
        let paper: HandwritingPaper
        let ink: UIColor
        let scale: CGFloat
        let em: CGFloat
        var pages: [UIImage] = []
        var ctx: CGContext?
        var y: CGFloat = 0
        var drift: CGFloat = 0
        var seed: UInt32
        var tints: [String: UIImage] = [:]
        let fallbackName: String

        init(atlas: HandAtlas?, paper: HandwritingPaper, ink: UIColor, seed: UInt32, scale: CGFloat) {
            self.atlas = atlas
            self.paper = paper
            self.ink = ink
            self.seed = seed == 0 ? 7 : seed
            self.scale = scale
            em = atlas.map { (line * 0.6) / max(0.2, $0.capHeight) } ?? line
            fallbackName = ["Noteworthy-Light", "BradleyHandITCTT-Bold", "ChalkboardSE-Light"].first { UIFont(name: $0, size: 12) != nil } ?? "Noteworthy-Light"
            newPage()
        }

        /// mulberry32, as on the web, so the same text looks the same everywhere.
        func rand() -> CGFloat {
            seed = seed &+ 0x6d2b79f5
            var t = seed
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return CGFloat((t ^ (t >> 14))) / 4294967296
        }

        // MARK: Pages

        func newPage() {
            if let ctx { UIGraphicsPopContext(); if let img = ctx.makeImage() { pages.append(UIImage(cgImage: img, scale: scale, orientation: .up)) } }
            let size = HandwritingRenderer.pageSize
            guard let c = CGContext(data: nil, width: Int(size.width * scale), height: Int(size.height * scale), bitsPerComponent: 8, bytesPerRow: 0,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return }
            c.translateBy(x: 0, y: size.height * scale)
            c.scaleBy(x: scale, y: -scale)
            ctx = c
            UIGraphicsPushContext(c)
            c.setFillColor(UIColor(rgb: 0xfffefb).cgColor)
            c.fill(CGRect(origin: .zero, size: size))
            switch paper {
            case .lined:
                c.setStrokeColor(UIColor(red: 90 / 255, green: 150 / 255, blue: 210 / 255, alpha: 0.32).cgColor)
                c.setLineWidth(0.8)
                var ly = top
                while ly < size.height - 30 { c.move(to: CGPoint(x: 0, y: ly + 0.5)); c.addLine(to: CGPoint(x: size.width, y: ly + 0.5)); ly += line }
                c.strokePath()
                c.setStrokeColor(UIColor(red: 220 / 255, green: 80 / 255, blue: 80 / 255, alpha: 0.45).cgColor)
                c.move(to: CGPoint(x: left - 14, y: 0)); c.addLine(to: CGPoint(x: left - 14, y: size.height))
                c.strokePath()
            case .grid:
                c.setStrokeColor(UIColor(red: 90 / 255, green: 150 / 255, blue: 210 / 255, alpha: 0.22).cgColor)
                c.setLineWidth(0.6)
                let step = line / 2
                var gx: CGFloat = 0
                while gx < size.width { c.move(to: CGPoint(x: gx + 0.5, y: 0)); c.addLine(to: CGPoint(x: gx + 0.5, y: size.height)); gx += step }
                var gy = top.truncatingRemainder(dividingBy: step)
                while gy < size.height { c.move(to: CGPoint(x: 0, y: gy + 0.5)); c.addLine(to: CGPoint(x: size.width, y: gy + 0.5)); gy += step }
                c.strokePath()
            case .blank:
                break
            }
            y = top + line - 3
        }

        func finish() -> [UIImage] {
            if let ctx { UIGraphicsPopContext(); if let img = ctx.makeImage() { pages.append(UIImage(cgImage: img, scale: scale, orientation: .up)) } }
            ctx = nil
            return Array(pages.prefix(12))
        }

        func ensureRoom(_ needed: CGFloat) {
            if y + needed > HandwritingRenderer.pageSize.height - bottom { newPage() }
        }

        // MARK: Characters

        private func fallbackFont(_ size: CGFloat, bold: Bool) -> UIFont {
            let f = UIFont(name: fallbackName, size: size) ?? .systemFont(ofSize: size)
            if bold, let d = f.fontDescriptor.withSymbolicTraits(.traitBold) { return UIFont(descriptor: d, size: size) }
            return f
        }

        func advance(_ ch: Character, _ s: CGFloat) -> CGFloat {
            let e = em * s
            if ch == " " { return e * 0.3 }
            if let g = atlas?.lookup(ch) { return g[0].advance * e + e * 0.035 }
            return (String(ch) as NSString).size(withAttributes: [.font: fallbackFont((line * 0.78 * s).rounded(), bold: false)]).width + 0.5
        }

        func measure(_ text: String, _ s: CGFloat) -> CGFloat { text.reduce(0) { $0 + advance($1, s) } }

        private func tinted(_ g: HandGlyph) -> UIImage {
            let key = "\(g.char):\(g.variant)"
            if let hit = tints[key] { return hit }
            let format = UIGraphicsImageRendererFormat()
            format.scale = g.image.scale
            let img = UIGraphicsImageRenderer(size: g.image.size, format: format).image { r in
                ink.setFill()
                r.fill(CGRect(origin: .zero, size: g.image.size))
                g.image.draw(at: .zero, blendMode: .destinationIn, alpha: 1)
            }
            tints[key] = img
            return img
        }

        @discardableResult
        func drawChar(_ ch: Character, x: CGFloat, baseline: CGFloat, s: CGFloat, bold: Bool, italic: Bool) -> CGFloat {
            guard let c = ctx else { return 0 }
            let e = em * s
            if ch == " " { return e * (0.27 + rand() * 0.07) }
            let jitterY = (rand() - 0.5) * 2.2 * s
            let rot = (rand() - 0.5) * 5 * .pi / 180 + (italic ? -0.12 : 0)
            let k = 0.95 + rand() * 0.1
            let alpha = 0.86 + rand() * 0.14
            c.saveGState()
            c.setAlpha(alpha)
            defer { c.restoreGState() }
            if let list = atlas?.lookup(ch) {
                let g = list[Int(rand() * CGFloat(list.count)) % list.count]
                let w = g.width * e * k, h = g.height * e * k
                let topY = baseline - g.baseline * e * k + jitterY
                c.translateBy(x: x + w / 2, y: topY + h / 2)
                c.rotate(by: rot)
                let img = tinted(g)
                img.draw(in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
                if bold { img.draw(in: CGRect(x: -w / 2 + 0.8, y: -h / 2 + 0.2, width: w, height: h)) }
                return g.advance * e * k + e * (0.02 + rand() * 0.03)
            }
            // No glyph for this character (or no profile yet): a handwriting-style font stands in.
            let font = fallbackFont((line * 0.78 * s * k).rounded(), bold: bold)
            c.translateBy(x: x, y: baseline + jitterY)
            c.rotate(by: rot * 0.6)
            let str = String(ch) as NSString
            str.draw(at: CGPoint(x: 0, y: -font.ascender), withAttributes: [.font: font, .foregroundColor: ink])
            return str.size(withAttributes: [.font: font]).width + 0.3 + rand() * 0.6
        }

        /// Writes runs as wrapped lines from the current baseline, moving `y` down as it goes.
        func write(_ runs: [Run], x0: CGFloat = HandwritingRenderer.left, x1: CGFloat = HandwritingRenderer.pageSize.width - HandwritingRenderer.right, s: CGFloat = 1) {
            let lineStep = line * max(1, (s * 0.95).rounded(.up))
            enum Word { case newline, space, word(String, Bool, Bool) }
            var words: [Word] = []
            for r in runs {
                var current = ""
                func flush() { if !current.isEmpty { words.append(.word(current, r.bold, r.italic)); current = "" } }
                for ch in r.text {
                    if ch == "\n" { flush(); words.append(.newline) } else if ch.isWhitespace { flush(); if case .space? = words.last {} else { words.append(.space) } } else { current.append(ch) }
                }
                flush()
            }
            var x = x0 + (rand() - 0.5) * 3
            ensureRoom(0)
            var slope = (rand() - 0.5) * 0.008
            var lineStart = x
            func nextLine() {
                y += lineStep
                ensureRoom(0)
                x = x0 + (rand() - 0.5) * 3
                lineStart = x
                slope = (rand() - 0.5) * 0.008
            }
            for w in words {
                switch w {
                case .newline: nextLine()
                case .space: if x > x0 { x += drawChar(" ", x: x, baseline: y, s: s, bold: false, italic: false) }
                case .word(let text, let bold, let italic):
                    if x + measure(text, s) > x1 && x > x0 + 4 { nextLine() }
                    for ch in text {
                        drift = drift * 0.9 + (rand() - 0.5) * 0.6
                        let base = y + (x - lineStart) * slope + drift
                        x += drawChar(ch, x: x, baseline: base, s: s, bold: bold, italic: italic)
                    }
                }
            }
        }

        // MARK: Rough strokes

        /// A hand-ruled line: two slightly bowed passes, like rough.js.
        func roughLine(_ a: CGPoint, _ b: CGPoint, width: CGFloat = 1.25) {
            guard let c = ctx else { return }
            let len = hypot(b.x - a.x, b.y - a.y)
            let off = min(1.6, len * 0.012) + 0.6
            c.setStrokeColor(ink.cgColor)
            c.setLineCap(.round)
            for pass in 0..<2 {
                c.setLineWidth(width * (pass == 0 ? 1 : 0.7))
                let j = { (self.rand() - 0.5) * off * 2 }
                let mid = CGPoint(x: (a.x + b.x) / 2 + j() * 1.4, y: (a.y + b.y) / 2 + j() * 1.4)
                c.move(to: CGPoint(x: a.x + j(), y: a.y + j()))
                c.addQuadCurve(to: CGPoint(x: b.x + j(), y: b.y + j()), control: mid)
                c.strokePath()
            }
        }

        /// Diagonal hatching inside a path, plus its rough outline.
        func hachure(_ path: CGPath, gap: CGFloat = 6, cross: Bool = false) {
            guard let c = ctx else { return }
            let box = path.boundingBox
            c.saveGState()
            c.addPath(path)
            c.clip()
            c.setStrokeColor(ink.withAlphaComponent(0.85).cgColor)
            c.setLineWidth(0.8)
            var t = box.minX - box.height
            while t < box.maxX {
                c.move(to: CGPoint(x: t + (rand() - 0.5), y: box.maxY + 1))
                c.addLine(to: CGPoint(x: t + box.height + (rand() - 0.5), y: box.minY - 1))
                if cross {
                    c.move(to: CGPoint(x: t + (rand() - 0.5), y: box.minY - 1))
                    c.addLine(to: CGPoint(x: t + box.height + (rand() - 0.5), y: box.maxY + 1))
                }
                t += gap
            }
            c.strokePath()
            c.restoreGState()
        }

        func roughRect(_ r: CGRect, fill: Bool) {
            if fill { hachure(CGPath(rect: r, transform: nil)) }
            roughLine(CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY))
            roughLine(CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY))
            roughLine(CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY))
            roughLine(CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.minX, y: r.minY))
        }

        func roughDot(_ center: CGPoint, d: CGFloat) {
            guard let c = ctx else { return }
            c.setFillColor(ink.cgColor)
            let jx = (rand() - 0.5) * 0.6, jy = (rand() - 0.5) * 0.6
            c.fillEllipse(in: CGRect(x: center.x - d / 2 + jx, y: center.y - d / 2 + jy, width: d * (0.95 + rand() * 0.1), height: d * (0.95 + rand() * 0.1)))
        }

        // MARK: Blocks

        private func runs(_ s: String, bold: Bool = false) -> [Run] {
            let attr = MarkdownBlock.inline(s)
            var out: [Run] = []
            for r in attr.runs {
                let text = String(attr[r.range].characters)
                let intent = r.inlinePresentationIntent ?? []
                out.append(Run(text: text, bold: bold || intent.contains(.stronglyEmphasized), italic: intent.contains(.emphasized)))
            }
            return out
        }

        func block(_ b: MarkdownBlock, depth: Int) {
            let indent = left + CGFloat(depth) * 26
            switch b {
            case .heading(let level, let text):
                let s: CGFloat = level == 1 ? 1.45 : level == 2 ? 1.25 : 1.1
                y += level == 1 ? line * 0.5 : line * 0.2
                ensureRoom(line * s)
                let startY = y
                let r = runs(text, bold: level <= 2)
                write(r, s: s)
                if level <= 2, y == startY {
                    let w = min(HandwritingRenderer.pageSize.width - right - left, measure(r.map(\.text).joined(), s) + 10)
                    roughLine(CGPoint(x: left - 2, y: y + 7), CGPoint(x: left + w, y: y + 6 + (rand() - 0.5) * 3), width: 1.4)
                }
                y += line * s.rounded(.up)
            case .paragraph(let text):
                write(runs(text), x0: indent)
                y += line
            case .listItem(let d, let marker, let text):
                let ind = left + CGFloat(depth + d) * 26
                ensureRoom(line)
                if let marker {
                    let save = y
                    write([Run(text: marker)], x0: ind)
                    y = save
                } else {
                    roughDot(CGPoint(x: ind + 6, y: y - 7), d: 4.5)
                }
                write(runs(text), x0: ind + 26)
                y += line
            case .quote(let inner):
                let startY = y - line + 10
                for sub in inner { block(sub, depth: depth + 1) }
                roughLine(CGPoint(x: indent + 8, y: startY), CGPoint(x: indent + 8, y: y - line + 4))
            case .table(let header, let rows):
                table(header: header.map(MarkdownBlock.plain), rows: rows.map { $0.map(MarkdownBlock.plain) })
                y += line * 0.5
            case .code(let language, let text):
                if language == "chart" {
                    chart(text)
                } else {
                    for l in text.components(separatedBy: "\n") {
                        write([Run(text: l)], x0: indent + 16, s: 0.92)
                        y += line
                    }
                }
            case .rule:
                ensureRoom(line)
                roughLine(CGPoint(x: left + 40, y: y - 10), CGPoint(x: HandwritingRenderer.pageSize.width - right - 40, y: y - 10 + (rand() - 0.5) * 4))
                y += line
            }
        }

        func table(header: [String], rows: [[String]]) {
            let cols = header.count
            guard cols > 0 else { return }
            let avail = HandwritingRenderer.pageSize.width - right - left
            let s: CGFloat = 0.9
            let natural = (0..<cols).map { i in max(measure(header[i], s), rows.map { measure($0.count > i ? $0[i] : "", s) }.max() ?? 0) + 18 }
            let total = natural.reduce(0, +)
            let widths = total <= avail ? natural : natural.map { $0 / total * avail }
            let all = [header] + rows
            y += 6
            for (r, row) in all.enumerated() {
                ensureRoom(line)
                let topY = y - line + 8
                var x = left
                let baseline = y
                for ci in 0..<cols {
                    let save = y
                    y = baseline
                    write([Run(text: ci < row.count ? row[ci] : "", bold: r == 0)], x0: x + 8, x1: x + widths[ci] - 6, s: s)
                    y = save
                    x += widths[ci]
                }
                let rightX = left + widths.reduce(0, +)
                roughLine(CGPoint(x: left, y: topY), CGPoint(x: rightX, y: topY))
                var vx = left
                for ci in 0...cols {
                    roughLine(CGPoint(x: vx, y: topY), CGPoint(x: vx, y: topY + line), width: 1.1)
                    vx += ci < cols ? widths[ci] : 0
                }
                if r == all.count - 1 { roughLine(CGPoint(x: left, y: topY + line), CGPoint(x: rightX, y: topY + line)) }
                y += line
            }
            y += 4
        }

        func chart(_ raw: String) {
            guard let data = raw.data(using: .utf8), let spec = try? JSONDecoder().decode(JSONValue.self, from: data) else {
                write([Run(text: raw)])
                return
            }
            let labels = Array(spec["labels"]?.array ?? []).prefix(12).map { $0.string ?? ($0.number.map { String($0) } ?? "") }
            let values = Array(spec["values"]?.array ?? []).prefix(12).map { CGFloat($0.number ?? 0) }
            let height = line * 8
            ensureRoom(height + line * 2)
            if let title = spec["title"]?.string {
                write([Run(text: title, bold: true)])
                y += line
            }
            let topY = y - line + 10
            let l = left + 30, r = HandwritingRenderer.pageSize.width - right - 10
            let bottomY = topY + height - line
            let maxV = max(1, values.map { abs($0) }.max() ?? 1)
            if spec["type"]?.string == "pie" {
                let cx = (l + r) / 2 - 80, cy = topY + height / 2 - 10
                let radius = min(height / 2 - 14, 120)
                let sum = max(values.map { abs($0) }.reduce(0, +), 1)
                var a = -CGFloat.pi / 2
                for (i, v) in values.enumerated() {
                    let da = abs(v) / sum * .pi * 2
                    let wedge = CGMutablePath()
                    wedge.move(to: CGPoint(x: cx, y: cy))
                    wedge.addArc(center: CGPoint(x: cx, y: cy), radius: radius, startAngle: a, endAngle: a + da, clockwise: false)
                    wedge.closeSubpath()
                    hachure(wedge, gap: 6 + CGFloat(i % 3) * 3, cross: i % 2 == 1)
                    roughLine(CGPoint(x: cx, y: cy), CGPoint(x: cx + radius * cos(a), y: cy + radius * sin(a)))
                    var t = a
                    while t < a + da {
                        let n = min(t + 0.25, a + da)
                        roughLine(CGPoint(x: cx + radius * cos(t), y: cy + radius * sin(t)), CGPoint(x: cx + radius * cos(n), y: cy + radius * sin(n)))
                        t = n
                    }
                    a += da
                }
                var ly = topY + 20
                for (i, lab) in labels.enumerated() {
                    let save = y
                    y = ly
                    write([Run(text: "\(lab): \(i < values.count ? HandwritingRenderer.num(values[i]) : "")")], x0: cx + radius + 40, s: 0.85)
                    y = save
                    ly += line * 0.85
                }
            } else {
                roughLine(CGPoint(x: l, y: topY), CGPoint(x: l, y: bottomY))
                roughLine(CGPoint(x: l, y: bottomY), CGPoint(x: r, y: bottomY))
                let n = CGFloat(max(1, values.count))
                let slot = (r - l) / n
                var pts: [CGPoint] = []
                for (i, v) in values.enumerated() {
                    let h = abs(v) / maxV * (bottomY - topY - 16)
                    let fi = CGFloat(i)
                    if spec["type"]?.string == "line" {
                        pts.append(CGPoint(x: l + slot * fi + slot / 2, y: bottomY - h))
                    } else {
                        roughRect(CGRect(x: l + slot * fi + slot * 0.2, y: bottomY - h, width: slot * 0.6, height: h), fill: true)
                    }
                    let save = y
                    y = bottomY + line * 0.8
                    write([Run(text: i < labels.count ? labels[i] : "")], x0: l + slot * fi + 4, x1: l + slot * (fi + 1), s: 0.72)
                    y = bottomY - h - 6
                    write([Run(text: HandwritingRenderer.num(v))], x0: l + slot * fi + slot * 0.3, x1: l + slot * (fi + 1) + 20, s: 0.7)
                    y = save
                }
                if pts.count > 1 {
                    for i in 1..<pts.count { roughLine(pts[i - 1], pts[i], width: 1.6) }
                    for p in pts { roughDot(p, d: 7) }
                }
            }
            y = topY + height + line
        }
    }

    static func num(_ v: CGFloat) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%g", Double(v))
    }
}

// MARK: View

/// Pages of handwriting with Share and Print. `compact` keeps it phone-card sized in a chat.
struct HandwritingView: View {
    let markdown: String
    let profileId: String?
    let paper: HandwritingPaper
    let ink: HandwritingInk
    var title = "Handwriting"
    var compact = false
    @Environment(SessionStore.self) private var session
    @State private var pages: [UIImage] = []
    @State private var busy = true
    @State private var zoomed: Int?

    private var key: String { "\(HandwritingRenderer.hash(markdown))-\(profileId ?? "")-\(paper.rawValue)-\(ink.rawValue)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if busy && pages.isEmpty {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.wash)
                    .aspectRatio(210 / 297, contentMode: .fit)
                    .frame(maxWidth: compact ? 300 : .infinity)
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { i, page in
                        Image(uiImage: page)
                            .resizable()
                            .aspectRatio(210 / 297, contentMode: .fit)
                            .clipShape(.rect(cornerRadius: 6, style: .continuous))
                            .overlay { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.primary.opacity(0.08)) }
                            .shadow(color: .black.opacity(0.06), radius: 6, y: 2)
                            .onTapGesture { zoomed = i }
                            .accessibilityLabel("Page \(i + 1) of \(title)")
                            .accessibilityAddTraits(.isButton)
                    }
                }
                .frame(maxWidth: compact ? 300 : .infinity, alignment: .leading)
                .opacity(busy ? 0.5 : 1)
                .transition(.opacity)
                HStack(spacing: 6) {
                    CardButton(title: "Share", systemImage: "square.and.arrow.up", style: .secondary) { share() }
                    CardButton(title: "Print", systemImage: "printer") { printPages() }
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: busy)
        .task(id: key) {
            busy = true
            var atlas: HandAtlas?
            if let profileId { atlas = await HandAtlasCache.load(profileId, api: session.api) }
            let out = await HandwritingRenderer.render(markdown, atlas: atlas, paper: paper, ink: ink, scale: compact ? 1.5 : 2)
            guard !Task.isCancelled else { return }
            pages = out
            busy = false
        }
        .fullScreenCover(item: Binding(get: { zoomed.map { ZoomPage(index: $0) } }, set: { zoomed = $0?.index })) { z in
            PageViewer(pages: pages, start: z.index)
        }
    }

    private struct ZoomPage: Identifiable { let index: Int; var id: Int { index } }

    private func share() {
        let items: [Any] = pages.compactMap { $0.pngData() }.enumerated().map { i, data in
            let name = title.replacingOccurrences(of: "[^\\p{L}\\p{N} _-]", with: "", options: .regularExpression).prefix(40)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name.isEmpty ? "handwriting" : String(name))-\(i + 1).png")
            try? data.write(to: url)
            return url
        }
        presentActivity(items)
    }

    private func printPages() {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = title
        info.outputType = .photo
        controller.printInfo = info
        controller.printingItems = pages
        controller.present(animated: true)
    }
}

/// Pages full screen: swipe between them, pinch to zoom, drag down to close.
private struct PageViewer: View {
    let pages: [UIImage]
    let start: Int
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var zoom: CGFloat = 1
    @State private var drag: CGFloat = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(1 - min(0.6, abs(drag) / 400)).ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, p in
                    Image(uiImage: p)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(i == index ? zoom : 1)
                        .gesture(MagnifyGesture().onChanged { zoom = max(1, $0.magnification) }.onEnded { _ in withAnimation(Motion.morph) { zoom = 1 } })
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .automatic : .never))
            .offset(y: drag)
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { v in if zoom == 1, abs(v.translation.height) > abs(v.translation.width) { drag = v.translation.height } }
                    .onEnded { v in
                        if abs(v.translation.height) > 120 || abs(v.predictedEndTranslation.height) > 400 { dismiss() } else { withAnimation(Motion.dismiss) { drag = 0 } }
                    }
            )
            GlassIconButton("xmark", accessibility: "Close") { dismiss() }
                .padding(16)
        }
        .onAppear { index = start }
    }
}

/// Opens the share sheet from wherever the app is.
@MainActor
func presentActivity(_ items: [Any]) {
    guard !items.isEmpty, var top = Screen.window?.rootViewController else { return }
    while let next = top.presentedViewController { top = next }
    let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
    vc.popoverPresentationController?.sourceView = top.view
    vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
    top.present(vc, animated: true)
}

// MARK: Template

/// The printable sheet you write your letters on: two A4 pages, every Greek and Latin letter, digit
/// and symbol twice, with corner markers the server finds in the photo. Same geometry as the web
/// (lib/handwriting/template.ts); all units are millimetres.
enum HandwritingTemplate {
    static let page = CGSize(width: 210, height: 297)
    static let markerSize: CGFloat = 8
    static let markers: [CGPoint] = [CGPoint(x: 10, y: 10), CGPoint(x: 200, y: 10), CGPoint(x: 10, y: 287), CGPoint(x: 200, y: 287)]
    static let grid = (x: CGFloat(15), y: CGFloat(26), cols: 12, rows: 14, cellW: CGFloat(15), cellH: CGFloat(18))
    static let cell = (label: CGFloat(3.6), pad: CGFloat(1.1), baseline: CGFloat(0.68))
    static let variants = 2

    static let charset: [String] = {
        let sets = [
            "αβγδεζηθικλμνξοπρσςτυφχψω", "άέήίόύώϊϋΐΰ", "abcdefghijklmnopqrstuvwxyz",
            "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789", ".,;:!?'\"()-+=/%&@#*€$<>[]_«»·",
        ]
        return sets.flatMap { $0.unicodeScalars.map { String($0) } }
    }()

    static var pageCount: Int { Int((Double(charset.count * variants) / Double(grid.cols * grid.rows)).rounded(.up)) }

    /// One page as a PDF, ready to print at 100% on A4.
    static func pdf(page n: Int, name: String = "") -> Data {
        let mm: CGFloat = 72 / 25.4
        let bounds = CGRect(x: 0, y: 0, width: page.width * mm, height: page.height * mm)
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { r in
            r.beginPage()
            let c = r.cgContext
            c.scaleBy(x: mm, y: mm)
            UIColor.white.setFill()
            c.fill(CGRect(origin: .zero, size: page))
            UIColor.black.setFill()
            for m in markers { c.fill(CGRect(x: m.x - markerSize / 2, y: m.y - markerSize / 2, width: markerSize, height: markerSize)) }
            func text(_ s: String, _ x: CGFloat, _ baseline: CGFloat, _ size: CGFloat, _ color: UIColor) {
                let font = UIFont(name: "Helvetica", size: size) ?? .systemFont(ofSize: size)
                (s as NSString).draw(at: CGPoint(x: x, y: baseline - font.ascender), withAttributes: [.font: font, .foregroundColor: color])
            }
            text("Opal Handwriting\(name.isEmpty ? "" : " · \(name)") · page \(n) of \(pageCount)", grid.x, 17, 4, UIColor(rgb: 0x9aa3ad))
            text("Write the character shown in each box with a dark pen, resting on the dotted line. Keep the four black squares visible when you take the photo.", grid.x, 22, 2.8, UIColor(rgb: 0xaab2bb))
            let perPage = grid.cols * grid.rows
            var i = 0
            for ch in charset {
                for _ in 0..<variants {
                    defer { i += 1 }
                    guard i / perPage + 1 == n else { continue }
                    let k = i % perPage
                    let x = grid.x + CGFloat(k % grid.cols) * grid.cellW
                    let y = grid.y + CGFloat(k / grid.cols) * grid.cellH
                    c.setLineWidth(0.25)
                    c.setStrokeColor(UIColor(rgb: 0xa8d4f5).cgColor)
                    c.stroke(CGRect(x: x, y: y, width: grid.cellW, height: grid.cellH))
                    c.setLineWidth(0.2)
                    c.setStrokeColor(UIColor(rgb: 0xcfe6f8).cgColor)
                    c.move(to: CGPoint(x: x, y: y + cell.label)); c.addLine(to: CGPoint(x: x + grid.cellW, y: y + cell.label)); c.strokePath()
                    text(ch, x + 1, y + 2.7, 2.6, UIColor(rgb: 0x9ccbee))
                    let bx = x + cell.pad
                    let by = y + cell.label + cell.pad * 0.6
                    let bw = grid.cellW - cell.pad * 2
                    let bh = grid.cellH - cell.label - cell.pad * 1.6
                    let base = by + bh * cell.baseline
                    c.setLineWidth(0.25)
                    c.setStrokeColor(UIColor(rgb: 0xa8d4f5).cgColor)
                    c.setLineDash(phase: 0, lengths: [0.8, 0.8])
                    c.move(to: CGPoint(x: bx, y: base)); c.addLine(to: CGPoint(x: bx + bw, y: base)); c.strokePath()
                    c.setLineDash(phase: 0, lengths: [])
                }
            }
        }
    }
}
