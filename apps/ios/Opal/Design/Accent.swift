import SwiftUI
import UIKit

/// The accent colours you can pick in Settings, the same set as the web (apps/web/src/lib/accents.ts
/// and the [data-accent] rules in globals.css). "mono" is the default: white in dark mode,
/// near-black in light mode.
enum AccentID: String, CaseIterable, Identifiable, Sendable {
    case mono, blue, teal, green, violet, pink, orange

    var id: String { rawValue }
    var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    static let `default` = AccentID.mono
}

/// One accent's three colours, each with a light and a dark value.
/// - `fill`: buttons and selected things (--opal-accent)
/// - `fg`: text and icons on `fill` (--opal-accent-fg)
/// - `line`: rings, checkmarks, links and the text cursor (--opal-accent-line)
struct AccentPalette: Sendable, Equatable {
    let id: AccentID
    let fill: Color
    let fg: Color
    let line: Color

    init(_ id: AccentID) {
        self.id = id
        switch id {
        case .mono:
            fill = .dynamic(0x1b1b1b, 0xf2f2f2); fg = .dynamic(0xfcfcfc, 0x131313); line = .dynamic(0x1b1b1b, 0xf2f2f2)
        case .blue:
            fill = .dynamic(0xd3e6ff, 0xa7cfff); fg = .dynamic(0x0b417f, 0x06223f); line = .dynamic(0x2d7fe0, 0x8ec2ff)
        case .teal:
            fill = .dynamic(0xc9f0e6, 0x8fe3cf); fg = .dynamic(0x074639, 0x04322a); line = .dynamic(0x0f7f68, 0x7adcc5)
        case .green:
            fill = .dynamic(0xd6f2cb, 0xade59e); fg = .dynamic(0x1c4a11, 0x10300a); line = .dynamic(0x2f7d1f, 0x9ade8a)
        case .violet:
            fill = .dynamic(0xe5ddff, 0xc8b8ff); fg = .dynamic(0x3a1d8c, 0x1d0f4d); line = .dynamic(0x6a4bd8, 0xb8a5ff)
        case .pink:
            fill = .dynamic(0xffdaeb, 0xffb5d5); fg = .dynamic(0x7a1244, 0x480927); line = .dynamic(0xc42d74, 0xffa2cb)
        case .orange:
            fill = .dynamic(0xffe2c2, 0xffc98f); fg = .dynamic(0x743500, 0x432000); line = .dynamic(0xb35d00, 0xffb56b)
        }
    }

    static func == (a: AccentPalette, b: AccentPalette) -> Bool { a.id == b.id }
}

extension EnvironmentValues {
    /// The accent the user picked. Set once at the root.
    @Entry var accent: AccentPalette = AccentPalette(.mono)
}

/// Light, dark, or whatever the system is set to.
enum ThemePreference: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension UIColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xff) / 255,
            green: CGFloat((rgb >> 8) & 0xff) / 255,
            blue: CGFloat(rgb & 0xff) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    /// A colour with one value in light mode and another in dark mode.
    static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }

    /// Danger red, as on the web (--color-danger).
    static let danger = Color.dynamic(0xd93636, 0xff6b6b)
    static let success = Color.dynamic(0x1f8a4c, 0x5ad38c)
    static let warning = Color.dynamic(0xb26b00, 0xffb547)
}

/// A swatch for the accent picker: the accent's fill with a ring in its line colour when picked.
struct AccentSwatch: View {
    let accent: AccentID
    let selected: Bool
    var size: CGFloat = 34

    var body: some View {
        let p = AccentPalette(accent)
        Circle()
            .fill(p.fill)
            .overlay { Circle().strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5) }
            .overlay {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: size * 0.38, weight: .bold))
                        .foregroundStyle(p.fg)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
            .padding(3)
            .overlay { Circle().strokeBorder(selected ? p.line : .clear, lineWidth: 2) }
            .frame(width: size + 6, height: size + 6)
            .animation(Motion.quick, value: selected)
            .accessibilityLabel(accent.label)
            .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
