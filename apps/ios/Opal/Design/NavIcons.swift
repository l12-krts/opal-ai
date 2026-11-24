import SwiftUI

/// The web sidebar's icons for its four destinations: Tabler's Code, Sparkles and Settings, and
/// Opal's own agent face (apps/web/src/components/icons.tsx). Drawn from the same 24pt paths with
/// Tabler's round strokes, so they match the web exactly.
enum NavGlyph {
    case code, agents, customization, settings
}

struct NavIcon: View {
    let glyph: NavGlyph
    var size: CGFloat = 22
    /// Tabler's stroke at 24pt; the web uses 1.5.
    var stroke: CGFloat = 1.5

    var body: some View {
        NavIconShape(glyph: glyph)
            .stroke(style: StrokeStyle(lineWidth: stroke * size / 24, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct NavIconShape: Shape {
    let glyph: NavGlyph

    func path(in rect: CGRect) -> Path {
        var p = Path()
        switch glyph {
        case .code:
            p.move(to: CGPoint(x: 7, y: 8))
            p.addLine(to: CGPoint(x: 3, y: 12))
            p.addLine(to: CGPoint(x: 7, y: 16))
            p.move(to: CGPoint(x: 17, y: 8))
            p.addLine(to: CGPoint(x: 21, y: 12))
            p.addLine(to: CGPoint(x: 17, y: 16))
            p.move(to: CGPoint(x: 14, y: 4))
            p.addLine(to: CGPoint(x: 10, y: 20))
        case .agents:
            p.addEllipse(in: CGRect(x: 3, y: 3, width: 18, height: 18))
            p.move(to: CGPoint(x: 9.5, y: 9.75))
            p.addLine(to: CGPoint(x: 9.5, y: 12.25))
            p.move(to: CGPoint(x: 14.5, y: 9.75))
            p.addLine(to: CGPoint(x: 14.5, y: 12.25))
        case .customization:
            p.move(to: CGPoint(x: 16, y: 18))
            p.addCurve(to: CGPoint(x: 18, y: 20), control1: CGPoint(x: 17.105, y: 18), control2: CGPoint(x: 18, y: 18.895))
            p.addCurve(to: CGPoint(x: 20, y: 18), control1: CGPoint(x: 18, y: 18.895), control2: CGPoint(x: 18.895, y: 18))
            p.addCurve(to: CGPoint(x: 18, y: 16), control1: CGPoint(x: 18.895, y: 18), control2: CGPoint(x: 18, y: 17.105))
            p.addCurve(to: CGPoint(x: 16, y: 18), control1: CGPoint(x: 18, y: 17.105), control2: CGPoint(x: 17.105, y: 18))
            p.move(to: CGPoint(x: 16, y: 6))
            p.addCurve(to: CGPoint(x: 18, y: 8), control1: CGPoint(x: 17.105, y: 6), control2: CGPoint(x: 18, y: 6.895))
            p.addCurve(to: CGPoint(x: 20, y: 6), control1: CGPoint(x: 18, y: 6.895), control2: CGPoint(x: 18.895, y: 6))
            p.addCurve(to: CGPoint(x: 18, y: 4), control1: CGPoint(x: 18.895, y: 6), control2: CGPoint(x: 18, y: 5.105))
            p.addCurve(to: CGPoint(x: 16, y: 6), control1: CGPoint(x: 18, y: 5.105), control2: CGPoint(x: 17.105, y: 6))
            p.move(to: CGPoint(x: 9, y: 18))
            p.addCurve(to: CGPoint(x: 15, y: 12), control1: CGPoint(x: 9, y: 14.686), control2: CGPoint(x: 11.686, y: 12))
            p.addCurve(to: CGPoint(x: 9, y: 6), control1: CGPoint(x: 11.686, y: 12), control2: CGPoint(x: 9, y: 9.314))
            p.addCurve(to: CGPoint(x: 3, y: 12), control1: CGPoint(x: 9, y: 9.314), control2: CGPoint(x: 6.314, y: 12))
            p.addCurve(to: CGPoint(x: 9, y: 18), control1: CGPoint(x: 6.314, y: 12), control2: CGPoint(x: 9, y: 14.686))
        case .settings:
            p.move(to: CGPoint(x: 10.325, y: 4.317))
            p.addCurve(to: CGPoint(x: 13.675, y: 4.317), control1: CGPoint(x: 10.751, y: 2.561), control2: CGPoint(x: 13.249, y: 2.561))
            p.addCurve(to: CGPoint(x: 14.691, y: 5.504), control1: CGPoint(x: 13.805, y: 4.852), control2: CGPoint(x: 14.182, y: 5.293))
            p.addCurve(to: CGPoint(x: 16.248, y: 5.383), control1: CGPoint(x: 15.199, y: 5.714), control2: CGPoint(x: 15.778, y: 5.67))
            p.addCurve(to: CGPoint(x: 18.618, y: 7.753), control1: CGPoint(x: 17.791, y: 4.443), control2: CGPoint(x: 19.558, y: 6.209))
            p.addCurve(to: CGPoint(x: 18.498, y: 9.309), control1: CGPoint(x: 18.332, y: 8.223), control2: CGPoint(x: 18.287, y: 8.801))
            p.addCurve(to: CGPoint(x: 19.683, y: 10.325), control1: CGPoint(x: 18.708, y: 9.818), control2: CGPoint(x: 19.148, y: 10.195))
            p.addCurve(to: CGPoint(x: 19.683, y: 13.675), control1: CGPoint(x: 21.439, y: 10.751), control2: CGPoint(x: 21.439, y: 13.249))
            p.addCurve(to: CGPoint(x: 18.496, y: 14.691), control1: CGPoint(x: 19.148, y: 13.805), control2: CGPoint(x: 18.707, y: 14.182))
            p.addCurve(to: CGPoint(x: 18.617, y: 16.248), control1: CGPoint(x: 18.286, y: 15.199), control2: CGPoint(x: 18.33, y: 15.778))
            p.addCurve(to: CGPoint(x: 16.247, y: 18.618), control1: CGPoint(x: 19.557, y: 17.791), control2: CGPoint(x: 17.791, y: 19.558))
            p.addCurve(to: CGPoint(x: 14.691, y: 18.498), control1: CGPoint(x: 15.777, y: 18.332), control2: CGPoint(x: 15.199, y: 18.287))
            p.addCurve(to: CGPoint(x: 13.675, y: 19.683), control1: CGPoint(x: 14.182, y: 18.708), control2: CGPoint(x: 13.805, y: 19.148))
            p.addCurve(to: CGPoint(x: 10.325, y: 19.683), control1: CGPoint(x: 13.249, y: 21.439), control2: CGPoint(x: 10.751, y: 21.439))
            p.addCurve(to: CGPoint(x: 9.309, y: 18.496), control1: CGPoint(x: 10.195, y: 19.148), control2: CGPoint(x: 9.818, y: 18.707))
            p.addCurve(to: CGPoint(x: 7.752, y: 18.617), control1: CGPoint(x: 8.801, y: 18.286), control2: CGPoint(x: 8.222, y: 18.33))
            p.addCurve(to: CGPoint(x: 5.382, y: 16.247), control1: CGPoint(x: 6.209, y: 19.557), control2: CGPoint(x: 4.442, y: 17.791))
            p.addCurve(to: CGPoint(x: 5.502, y: 14.691), control1: CGPoint(x: 5.668, y: 15.777), control2: CGPoint(x: 5.713, y: 15.199))
            p.addCurve(to: CGPoint(x: 4.317, y: 13.675), control1: CGPoint(x: 5.292, y: 14.182), control2: CGPoint(x: 4.852, y: 13.805))
            p.addCurve(to: CGPoint(x: 4.317, y: 10.325), control1: CGPoint(x: 2.561, y: 13.249), control2: CGPoint(x: 2.561, y: 10.751))
            p.addCurve(to: CGPoint(x: 5.504, y: 9.309), control1: CGPoint(x: 4.852, y: 10.195), control2: CGPoint(x: 5.293, y: 9.818))
            p.addCurve(to: CGPoint(x: 5.383, y: 7.752), control1: CGPoint(x: 5.714, y: 8.801), control2: CGPoint(x: 5.67, y: 8.222))
            p.addCurve(to: CGPoint(x: 7.753, y: 5.382), control1: CGPoint(x: 4.443, y: 6.209), control2: CGPoint(x: 6.209, y: 4.442))
            p.addCurve(to: CGPoint(x: 10.325, y: 4.317), control1: CGPoint(x: 8.753, y: 5.99), control2: CGPoint(x: 10.049, y: 5.452))
            p.move(to: CGPoint(x: 9, y: 12))
            p.addCurve(to: CGPoint(x: 12, y: 15), control1: CGPoint(x: 9, y: 13.657), control2: CGPoint(x: 10.343, y: 15))
            p.addCurve(to: CGPoint(x: 15, y: 12), control1: CGPoint(x: 13.657, y: 15), control2: CGPoint(x: 15, y: 13.657))
            p.addCurve(to: CGPoint(x: 12, y: 9), control1: CGPoint(x: 15, y: 10.343), control2: CGPoint(x: 13.657, y: 9))
            p.addCurve(to: CGPoint(x: 9, y: 12), control1: CGPoint(x: 10.343, y: 9), control2: CGPoint(x: 9, y: 10.343))
        }
        let s = min(rect.width, rect.height) / 24
        return p.applying(CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: s, y: s))
    }
}
