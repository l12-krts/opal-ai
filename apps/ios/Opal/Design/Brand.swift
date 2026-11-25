import SwiftUI

/// The Opal wordmark (the mark, then "Opal"), drawn from the same outlines as the web
/// (apps/web/src/lib/brand-paths.ts). Drawn rather than an asset, so it is crisp at any size and
/// takes the foreground style like text. Fill it with `eoFill` (the mark has a hole).
struct WordmarkShape: Shape {
    /// The outlines' bounds, in the units of `commands`.
    static let viewBox = CGRect(x: 24, y: 24, width: 705, height: 243)
    static var aspectRatio: CGFloat { viewBox.width / viewBox.height }

    func path(in rect: CGRect) -> Path {
        let box = Self.viewBox
        let k = min(rect.width / box.width, rect.height / box.height)
        let x = rect.minX + (rect.width - box.width * k) / 2 - box.minX * k
        let y = rect.minY + (rect.height - box.height * k) / 2 - box.minY * k
        return Self.outline.applying(CGAffineTransform(a: k, b: 0, c: 0, d: k, tx: x, ty: y))
    }

    private static let outline = parse(commands)

    /// Absolute moves, lines and cubic curves, made from the web's SVG path (arcs already turned
    /// into curves), so there's nothing to interpret but numbers.
    private static let commands = """
        M 24 144 C 24 77.73 77.73 24 144 24 L 234 24 C 250.57 24 264 37.43 264 54 L 264 144 C 264 210.27 210.27 264 144 264
        L 54 264 C 37.43 264 24 250.57 24 234 Z M 54 144 C 54 193.71 94.29 234 144 234 C 193.71 234 234 193.71 234 144
        C 234 94.29 193.71 54 144 54 C 94.29 54 54 94.29 54 144 Z M 452.76 145.08 C 452.76 156.61 450.86 167.37 447.07 177.36
        C 443.27 187.35 437.96 196.12 431.12 203.68 C 424.28 211.24 416.28 217.13 407.11 221.35 C 397.94 225.57 388.02 227.69 377.35 227.69
        C 366.68 227.69 356.78 225.58 347.65 221.35 C 338.52 217.12 330.55 211.24 323.75 203.68 C 316.95 196.13 311.65 187.35 307.85 177.36
        C 304.05 167.37 302.16 156.61 302.16 145.08 C 302.16 133.55 304.06 122.77 307.85 112.75 C 311.64 102.72 316.94 93.93 323.75 86.38
        C 330.55 78.83 338.52 72.92 347.65 68.66 C 356.78 64.4 366.68 62.27 377.35 62.27 C 388.02 62.27 397.94 64.4 407.11 68.66
        C 416.28 72.92 424.28 78.83 431.12 86.38 C 437.96 93.94 443.28 102.73 447.07 112.75 C 450.86 122.78 452.76 133.55 452.76 145.08
        Z M 329.23 145.08 C 329.23 155.97 331.41 165.63 335.78 174.08 C 340.15 182.53 345.99 189.16 353.29 193.95
        C 360.59 198.75 368.65 201.15 377.46 201.15 C 386.27 201.15 394.22 198.75 401.52 193.95 C 408.82 189.15 414.66 182.53 419.03 174.08
        C 423.4 165.63 425.58 155.96 425.58 145.08 C 425.58 134.2 423.39 124.4 419.03 115.91 C 414.66 107.42 408.82 100.78 401.52 95.98
        C 394.22 91.18 386.19 88.78 377.46 88.78 C 368.73 88.78 360.59 91.18 353.29 95.98 C 345.99 100.78 340.15 107.42 335.78 115.91
        C 331.41 124.4 329.23 134.12 329.23 145.08 Z M 465.71 266.89 L 465.71 113.82 L 492.03 113.82
        L 492.03 128.54 C 494.46 124.67 497.6 121.45 501.43 118.87 C 505.26 116.29 509.41 114.38 513.89 113.12
        C 518.36 111.87 522.79 111.24 527.16 111.24 C 536.61 111.24 545.03 113.82 552.4 118.97 C 559.78 124.13 565.58 131.09 569.8 139.86
        C 574.02 148.63 576.14 158.43 576.14 169.24 C 576.14 180.05 574.01 189.86 569.75 198.67 C 565.49 207.48 559.65 214.46 552.24 219.62
        C 544.83 224.78 536.43 227.35 527.05 227.35 C 522.32 227.35 517.77 226.67 513.41 225.31 C 509.04 223.95 505.07 221.87 501.49 219.08
        C 497.91 216.29 494.9 212.81 492.47 208.66 L 492.47 266.88 L 465.72 266.88 Z M 490.52 169.25
        C 490.52 175.91 491.84 181.86 494.49 187.08 C 497.14 192.31 500.76 196.43 505.34 199.43 C 509.92 202.44 515.08 203.94 520.81 203.94
        C 526.54 203.94 531.19 202.51 535.63 199.64 C 540.07 196.78 543.6 192.73 546.21 187.5 C 548.82 182.27 550.13 176.19 550.13 169.24
        C 550.13 162.29 548.82 156.12 546.21 150.92 C 543.59 145.73 540.07 141.68 535.63 138.78 C 531.19 135.88 526.25 134.43 520.81 134.43
        C 515.08 134.43 509.92 135.95 505.34 139 C 500.76 142.04 497.14 146.18 494.49 151.41 C 491.84 156.64 490.52 162.58 490.52 169.24
        Z M 657.19 215.44 C 655.54 218.02 653.23 220.13 650.26 221.78 C 647.29 223.43 643.67 224.65 639.41 225.43
        C 635.15 226.22 630.3 226.61 624.85 226.61 C 617.55 226.61 610.97 225.27 605.14 222.58 C 599.3 219.89 594.68 216.06 591.28 211.09
        C 587.88 206.11 586.18 200.19 586.18 193.31 C 586.18 186.43 588.18 180.2 592.2 175.48 C 596.21 170.75 601.56 167.08 608.26 164.47
        C 614.96 161.86 622.24 160.12 630.12 159.26 C 636.42 158.55 641.63 157.74 645.75 156.84 C 649.87 155.95 652.95 154.8 654.99 153.4
        C 657.03 152 658.05 150.3 658.05 148.3 L 658.05 147.55 C 658.05 144.33 657.1 141.55 655.2 139.22
        C 653.3 136.89 650.76 135.1 647.57 133.85 C 644.38 132.6 640.93 131.97 637.2 131.97 C 633.26 131.97 629.47 132.42 625.81 133.31
        C 622.16 134.21 618.81 135.69 615.77 137.77 C 612.73 139.85 610.24 142.6 608.3 146.04 L 590.25 144.54
        C 590.46 138.31 592.61 132.67 596.7 127.62 C 600.79 122.57 606.42 118.58 613.62 115.64 C 620.82 112.7 629.14 111.24 638.6 111.24
        C 645.62 111.24 651.92 112.19 657.51 114.09 C 663.1 115.99 667.89 118.64 671.9 122.04 C 675.91 125.44 678.97 129.42 681.08 133.96
        C 683.19 138.51 684.25 143.4 684.25 148.62 L 684.25 225 L 657.61 225 L 657.61 215.44 L 657.18 215.44
        Z M 612.39 193.1 C 612.39 195.75 613.18 198.11 614.75 200.19 C 616.32 202.27 618.54 203.88 621.41 205.02
        C 624.27 206.17 627.6 206.74 631.4 206.74 C 636.91 206.74 641.68 205.7 645.69 203.62 C 649.7 201.54 652.78 198.73 654.93 195.19
        C 657.08 191.65 658.15 187.72 658.15 183.43 L 658.15 171.18 C 657 171.82 655.25 172.49 652.89 173.17
        C 650.53 173.85 647.7 174.53 644.4 175.21 C 641.11 175.89 637.49 176.55 633.55 177.2 C 627.82 178.06 622.86 179.82 618.67 182.46
        C 614.48 185.11 612.39 188.66 612.39 193.09 Z M 728.79 59.57 L 728.79 225 L 702.15 225 L 702.15 59.57
        L 728.79 59.57 Z
        """

    private static func parse(_ string: String) -> Path {
        var path = Path()
        var op: Character = "M"
        var numbers: [CGFloat] = []
        func flush() {
            switch op {
            case "M" where numbers.count == 2: path.move(to: CGPoint(x: numbers[0], y: numbers[1]))
            case "L" where numbers.count == 2: path.addLine(to: CGPoint(x: numbers[0], y: numbers[1]))
            case "C" where numbers.count == 6:
                path.addCurve(to: CGPoint(x: numbers[4], y: numbers[5]), control1: CGPoint(x: numbers[0], y: numbers[1]), control2: CGPoint(x: numbers[2], y: numbers[3]))
            default: break
            }
            numbers.removeAll(keepingCapacity: true)
        }
        for token in string.split(whereSeparator: \.isWhitespace) {
            if let first = token.first, first.isLetter {
                flush()
                op = first
                if op == "Z" { path.closeSubpath() }
            } else if let value = Double(token) {
                numbers.append(CGFloat(value))
            }
        }
        flush()
        return path
    }
}

/// The wordmark at a given height, in the foreground style.
struct Wordmark: View {
    var height: CGFloat = 22
    var body: some View {
        WordmarkShape()
            .fill(style: FillStyle(eoFill: true))
            .frame(width: (height * WordmarkShape.aspectRatio).rounded(), height: height)
            .accessibilityElement()
            .accessibilityLabel("Opal")
            .accessibilityAddTraits(.isImage)
    }
}
