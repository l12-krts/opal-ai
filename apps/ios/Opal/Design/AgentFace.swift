import SwiftUI

/// Agent body shapes, the same twelve as the web (apps/web/src/lib/agent-shapes.ts): a closed path
/// in a 100×100 box, plus where the two eyes sit.
struct AgentShape: Sendable {
    struct Eyes: Sendable { let y: CGFloat; let gap: CGFloat; let w: CGFloat; let h: CGFloat }

    let id: String
    let label: String
    let path: Path
    let eyes: Eyes

    private static let eyes = Eyes(y: 46, gap: 24, w: 10, h: 18)

    nonisolated(unsafe) static let all: [AgentShape] = [
        AgentShape(id: "circle", label: "Circle", path: polar { _ in 47 }, eyes: eyes),
        AgentShape(id: "squircle", label: "Squircle", path: polar(samples: 128) { t in
            // Superellipse, n = 4.
            let a = t - .pi / 2
            let c = pow(abs(cos(a)), 4)
            let s = pow(abs(sin(a)), 4)
            return 46 / pow(c + s, 0.25)
        }, eyes: eyes),
        AgentShape(id: "pill", label: "Pill", path: Path(roundedRect: CGRect(x: 0, y: 20, width: 100, height: 60), cornerRadius: 30), eyes: Eyes(y: 49, gap: 26, w: 10, h: 18)),
        AgentShape(id: "arch", label: "Arch", path: arch, eyes: Eyes(y: 52, gap: 24, w: 10, h: 18)),
        AgentShape(id: "ghost", label: "Ghost", path: ghost, eyes: eyes),
        AgentShape(id: "triangle", label: "Triangle", path: roundedPolygon([CGPoint(x: 50, y: 6), CGPoint(x: 96, y: 88), CGPoint(x: 4, y: 88)], radius: 16), eyes: Eyes(y: 64, gap: 20, w: 9, h: 16)),
        AgentShape(id: "diamond", label: "Diamond", path: roundedPolygon([CGPoint(x: 50, y: 3), CGPoint(x: 97, y: 50), CGPoint(x: 50, y: 97), CGPoint(x: 3, y: 50)], radius: 18), eyes: Eyes(y: 49, gap: 22, w: 9, h: 16)),
        AgentShape(id: "pentagon", label: "Pentagon", path: roundedPolygon(regular(sides: 5, r: 50, cy: 54), radius: 14), eyes: Eyes(y: 52, gap: 24, w: 10, h: 18)),
        AgentShape(id: "hexagon", label: "Hexagon", path: roundedPolygon(regular(sides: 6, r: 49), radius: 13), eyes: eyes),
        AgentShape(id: "cookie", label: "Cookie", path: polar(samples: 140) { t in 43 + 4.5 * cos(7 * t) }, eyes: eyes),
        AgentShape(id: "clover", label: "Clover", path: polar(samples: 160) { t in 33 + 15 * pow(abs(cos(2 * t)), 0.55) }, eyes: Eyes(y: 47, gap: 22, w: 9, h: 16)),
        AgentShape(id: "burst", label: "Burst", path: polar(samples: 192) { t in 42 + 6 * cos(12 * t) }, eyes: eyes),
    ]

    static func of(_ id: String?) -> AgentShape { all.first { $0.id == id } ?? all[0] }

    /// The agent colours you can pick (AGENT_COLORS on the web).
    static let colors: [(id: String, value: String)] = [
        ("slate", "#64748b"), ("blue", "#3b82f6"), ("teal", "#14b8a6"), ("green", "#22a35a"),
        ("amber", "#d99a1e"), ("orange", "#ea6a2a"), ("rose", "#e2496b"), ("violet", "#8b5cf6"),
    ]

    // MARK: Geometry

    /// Smooth closed curve through points (Catmull-Rom as cubic Béziers).
    private static func smooth(_ p: [CGPoint]) -> Path {
        var path = Path()
        let n = p.count
        path.move(to: p[0])
        for i in 0..<n {
            let p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]
            path.addCurve(
                to: p2,
                control1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                control2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            )
        }
        path.closeSubpath()
        return path
    }

    /// A curve from a polar radius function, first sample pointing straight up.
    private static func polar(samples: Int = 96, _ r: (CGFloat) -> CGFloat) -> Path {
        smooth((0..<samples).map { i in
            let t = CGFloat(i) / CGFloat(samples) * 2 * .pi
            let a = t - .pi / 2
            let rr = r(t)
            return CGPoint(x: 50 + rr * cos(a), y: 50 + rr * sin(a))
        })
    }

    /// A polygon with every corner rounded.
    private static func roundedPolygon(_ v: [CGPoint], radius: CGFloat) -> Path {
        var path = Path()
        let n = v.count
        for i in 0..<n {
            let prev = v[(i - 1 + n) % n], cur = v[i], next = v[(i + 1) % n]
            let tp = CGPoint(x: prev.x - cur.x, y: prev.y - cur.y)
            let tn = CGPoint(x: next.x - cur.x, y: next.y - cur.y)
            let lp = hypot(tp.x, tp.y), ln = hypot(tn.x, tn.y)
            let r = min(radius, lp / 2, ln / 2)
            let a = CGPoint(x: cur.x + tp.x / lp * r, y: cur.y + tp.y / lp * r)
            let b = CGPoint(x: cur.x + tn.x / ln * r, y: cur.y + tn.y / ln * r)
            if i == 0 { path.move(to: a) } else { path.addLine(to: a) }
            path.addQuadCurve(to: b, control: cur)
        }
        path.closeSubpath()
        return path
    }

    private static func regular(sides: Int, r: CGFloat, cx: CGFloat = 50, cy: CGFloat = 50, rotate: CGFloat = -90) -> [CGPoint] {
        (0..<sides).map { i in
            let a = (rotate + 360 / CGFloat(sides) * CGFloat(i)) * .pi / 180
            return CGPoint(x: cx + r * cos(a), y: cy + r * sin(a))
        }
    }

    /// M8 52 A42 42 0 0 1 92 52 V80 Q92 94 78 94 H22 Q8 94 8 80 Z
    private static var arch: Path {
        var p = Path()
        p.move(to: CGPoint(x: 8, y: 52))
        p.addArc(center: CGPoint(x: 50, y: 52), radius: 42, startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
        p.addLine(to: CGPoint(x: 92, y: 80))
        p.addQuadCurve(to: CGPoint(x: 78, y: 94), control: CGPoint(x: 92, y: 94))
        p.addLine(to: CGPoint(x: 22, y: 94))
        p.addQuadCurve(to: CGPoint(x: 8, y: 80), control: CGPoint(x: 8, y: 94))
        p.closeSubpath()
        return p
    }

    /// A dome over a wavy hem.
    private static var ghost: Path {
        var p = Path()
        p.move(to: CGPoint(x: 10, y: 48))
        p.addArc(center: CGPoint(x: 50, y: 48), radius: 40, startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
        p.addLine(to: CGPoint(x: 90, y: 86))
        let hem: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (83.3, 98, 76.7, 88), (70, 79, 63.3, 88), (56.7, 98, 50, 88),
            (43.3, 79, 36.7, 88), (30, 98, 23.3, 88), (16.7, 79, 10, 86),
        ]
        for (cx, cy, x, y) in hem { p.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cx, y: cy)) }
        p.closeSubpath()
        return p
    }
}

/// An agent's face: its body shape in its colour, with two eyes. The eyes blink now and then
/// (faces 24pt and up) and glance side to side while the agent is working, like the web.
/// Clock-driven, so no repeating animation can leak into the views around it.
struct AgentFace: View {
    let shape: String?
    let color: String
    var size: CGFloat = 20
    var working = false
    var blink: Bool?
    /// Varies the blink timing between faces.
    var seed = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let s = AgentShape.of(shape)
        let doBlink = (blink ?? (size >= 24)) && !reduceMotion
        let look = working && !reduceMotion
        Group {
            if doBlink || look {
                TimelineView(.animation) { context in
                    face(s, at: context.date.timeIntervalSinceReferenceDate, blink: doBlink, look: look)
                }
            } else {
                face(s, at: 0, blink: false, look: false)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func face(_ s: AgentShape, at time: TimeInterval, blink: Bool, look: Bool) -> some View {
        let k = size / 100
        let n = Self.hash(seed.isEmpty ? "\(shape ?? "")\(color)" : seed)
        // Blink: 97% of the way through each period the eyes close to 12% height.
        var scaleY: CGFloat = 1
        if blink {
            let period = 4.2 + Double(n % 30) / 10
            let delay = Double(n % 47) / 10
            let t = ((time + delay).truncatingRemainder(dividingBy: period)) / period
            scaleY = t < 0.95 ? 1 : t < 0.97 ? 1 - 0.88 * (t - 0.95) / 0.02 : 0.12 + 0.88 * (t - 0.97) / 0.03
        }
        // Glance: left, hold, right, hold, back (2.6s, ease-in-out between holds).
        var dx: CGFloat = 0
        if look {
            let t = time.truncatingRemainder(dividingBy: 2.6) / 2.6
            dx = Self.glance(t) * 5
        }
        let e = s.eyes
        return ZStack(alignment: .topLeading) {
            s.path.applying(CGAffineTransform(scaleX: k, y: k)).fill(Color(hex: color))
            ForEach([CGFloat(-1), CGFloat(1)], id: \.self) { side in
                Capsule()
                    .fill(.white)
                    .frame(width: e.w * k, height: e.h * k)
                    .scaleEffect(x: 1, y: scaleY, anchor: .center)
                    .offset(x: (50 + side * e.gap / 2 - e.w / 2 + dx) * k, y: (e.y - e.h / 2) * k)
            }
        }
        .frame(width: size, height: size, alignment: .topLeading)
    }

    /// The web's agent-look keyframes: 0–12% centre, 25–42% left, 58–78% right, back to centre.
    private static func glance(_ t: Double) -> CGFloat {
        func ease(_ x: Double) -> Double { x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2 }
        func lerp(_ a: Double, _ b: Double, _ from: Double, _ to: Double) -> Double { a + (b - a) * ease((t - from) / (to - from)) }
        switch t {
        case ..<0.12: return 0
        case ..<0.25: return CGFloat(lerp(0, -1, 0.12, 0.25))
        case ..<0.42: return -1
        case ..<0.58: return CGFloat(lerp(-1, 1, 0.42, 0.58))
        case ..<0.78: return 1
        default: return CGFloat(lerp(1, 0, 0.78, 1))
        }
    }

    static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 2166136261
        for c in s.utf16 { h = (h ^ UInt32(c)) &* 16777619 }
        return h
    }
}

/// Who sent an agent message: Opal (the mark) or an agent (its face).
struct SenderFace: View {
    let kind: String?
    let name: String
    let color: String?
    let shape: String?
    var size: CGFloat = 16

    var body: some View {
        if kind == "opal" || color == nil {
            OpalMark(size: (size * 0.9).rounded()).foregroundStyle(.primary)
                .frame(width: size, height: size)
        } else {
            AgentFace(shape: shape, color: color ?? "#8a8a8a", size: size, seed: name)
        }
    }
}
