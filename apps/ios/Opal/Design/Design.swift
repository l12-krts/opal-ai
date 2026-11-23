import SwiftUI

// Shared look and motion. Liquid Glass needs iOS 26; older systems get a material with a hairline,
// which reads the same at a glance.

enum Motion {
    /// The web composer's morph curve (cubic-bezier(0.23, 1, 0.32, 1), 240ms).
    static let morph = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.26)
    /// The sidebar: no bounce, slightly longer because it moves the whole screen.
    static let drawer = Animation.spring(duration: 0.4, bounce: 0)
    /// Menus opening out of a button.
    static let pop = Animation.spring(duration: 0.38, bounce: 0.16)
    /// Menus closing: faster than they open, the system is just responding.
    static let dismiss = Animation.spring(duration: 0.24, bounce: 0)
    /// Press feedback and small state changes.
    static let quick = Animation.easeOut(duration: 0.16)
    /// A menu growing into a large panel (the camera): a big surface, so a touch slower, no bounce.
    static let panel = Animation.spring(duration: 0.46, bounce: 0.06)
}

/// The window the app is in, for layouts that reach past their own view (the camera panel).
@MainActor
enum Screen {
    static var window: UIWindow? {
        UIApplication.shared.connectedScenes.lazy.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    }

    static var bounds: CGRect { window?.bounds ?? .zero }

    /// The display's corner radius, in points. There's no public API for it before iOS 26, so
    /// this goes by screen width; phones with a home button have square corners.
    static var cornerRadius: CGFloat {
        guard let window, window.safeAreaInsets.bottom > 0 else { return 0 }
        guard UIDevice.current.userInterfaceIdiom == .phone else { return 18 }
        switch min(window.bounds.width, window.bounds.height) {
        case 402...: return 62          // 16 Pro, 16 Pro Max, 17 and later
        case 393, 430: return 55        // 14 Pro to 16 Plus
        case 390, 428: return 47.3      // 12 to 14 Plus
        case 375: return 44             // X, XS, 11 Pro, mini
        default: return 41.5            // XR, 11
        }
    }

    /// A corner radius that runs parallel to the display's corner, `inset` points inside it.
    static func concentric(inset: CGFloat, minimum: CGFloat = 20) -> CGFloat {
        max(cornerRadius - inset, minimum)
    }
}

extension Color {
    /// The app's canvas. Pure system background, so the glass has something to refract.
    static let canvas = Color(uiColor: .systemBackground)
    /// The sidebar sits one step back from the canvas.
    static let sidebar = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.04, alpha: 1) : UIColor(white: 0.965, alpha: 1) })
    /// Brand ink: near-black on light, near-white on dark (apps/web/src/lib/brand-paths.ts).
    static let ink = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.96, alpha: 1) : UIColor(white: 0.067, alpha: 1) })
    /// A quiet fill for rows, bubbles and chips.
    static let wash = Color.primary.opacity(0.065)
}

// MARK: Glass

@available(iOS 26.0, *)
private func opalGlassStyle(interactive: Bool, tint: Color?) -> Glass {
    var glass = Glass.regular
    if let tint { glass = glass.tint(tint) }
    if interactive { glass = glass.interactive() }
    return glass
}

extension View {
    /// Liquid Glass in `shape` on iOS 26, a material with a hairline before that.
    @ViewBuilder
    func opalGlass<S: Shape>(in shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(opalGlassStyle(interactive: interactive, tint: tint), in: shape)
        } else {
            self
                .background {
                    if let tint { shape.fill(tint) } else { shape.fill(.regularMaterial) }
                }
                .overlay { shape.stroke(Color.primary.opacity(0.08), lineWidth: 0.5) }
                .shadow(color: .black.opacity(0.08), radius: 14, y: 6)
        }
    }

    /// Lets two glass shapes in one `GlassGroup` melt into each other as they appear and go.
    @ViewBuilder
    func opalGlassID(_ id: String, in namespace: Namespace.ID) -> some View {
        if #available(iOS 26.0, *) { self.glassEffectID(id, in: namespace) } else { self }
    }

    /// A bar pinned to the top that content scrolls under (with the iOS 26 scroll edge effect).
    @ViewBuilder
    func topBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: .top, spacing: 0) { bar() }
        } else {
            self.safeAreaInset(edge: .top, spacing: 0) {
                bar().background {
                    LinearGradient(colors: [Color.canvas, Color.canvas.opacity(0.85), Color.canvas.opacity(0)], startPoint: .top, endPoint: .bottom)
                        .padding(.bottom, -18)
                        .ignoresSafeArea()
                }
            }
        }
    }

    /// A bar pinned to the bottom, like the composer.
    @ViewBuilder
    func bottomBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: .bottom, spacing: 0) { bar() }
        } else {
            self.safeAreaInset(edge: .bottom, spacing: 0) {
                bar().background {
                    LinearGradient(colors: [Color.canvas.opacity(0), Color.canvas.opacity(0.9), Color.canvas], startPoint: .top, endPoint: .bottom)
                        .padding(.top, -18)
                        .ignoresSafeArea()
                }
            }
        }
    }
}

/// Groups glass shapes so they blend when close (iOS 26). A plain container before that.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

// MARK: Buttons

/// Scales down a touch while pressed, so every tap is acknowledged.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(Motion.quick, value: configuration.isPressed)
    }
}

/// A round glass button for the floating bars (sidebar, new chat, search).
struct GlassIconButton<Label: View>: View {
    var size: CGFloat = 44
    var accessibility: String
    var action: () -> Void
    @ViewBuilder var label: Label

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: size, height: size)
                .contentShape(Circle())
                .opalGlass(in: Circle(), interactive: true)
        }
        .buttonStyle(PressableStyle(scale: 0.94))
        .accessibilityLabel(accessibility)
    }
}

extension GlassIconButton where Label == Image {
    init(_ systemImage: String, size: CGFloat = 44, accessibility: String, action: @escaping () -> Void) {
        self.size = size
        self.accessibility = accessibility
        self.action = action
        self.label = Image(systemName: systemImage)
    }
}

/// Two bars of different lengths: the sidebar button.
struct SidebarGlyph: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Capsule().frame(width: 18, height: 2.2)
            Capsule().frame(width: 11, height: 2.2)
        }
        .frame(width: 18, height: 18, alignment: .leading)
    }
}

// MARK: Brand

/// The Opal wordmark (mark + "Opal"), drawn from the same outlines as the web.
struct Wordmark: View {
    var height: CGFloat = 22
    var body: some View {
        Image("Wordmark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(height: height)
            .accessibilityLabel("Opal")
    }
}

/// The mark, turning slowly: Opal is working on something.
struct WorkingMark: View {
    var size: CGFloat = 16
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turning = false

    var body: some View {
        OpalMark(size: size)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { turning = true }
            }
    }
}

/// Text with a light sweeping across it while something is in progress.
struct ShimmerText: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, Color.primary.opacity(0.85), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: phase * geo.size.width * 1.2)
                    }
                    .mask { Text(text) }
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) { phase = 1.2 }
            }
    }
}

/// "Good evening, Name", worked out once per screen.
enum Greeting {
    static func now(name: String?) -> String {
        let h = Calendar.current.component(.hour, from: .now)
        let first = (name ?? "").split(separator: " ").first.map(String.init) ?? ""
        let base = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : h < 23 ? "Good evening" : "Up late"
        return first.isEmpty ? base : "\(base), \(first)"
    }
}

/// Hides the keyboard, wherever focus is.
@MainActor
func dismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
