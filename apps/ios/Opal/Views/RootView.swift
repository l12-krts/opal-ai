import SwiftUI

struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .locked: UnlockView()
            case .signedOut: LoginView()
            case .signedIn: MainView()
            }
        }
        .animation(.smooth(duration: 0.25), value: session.phase)
    }
}

/// The Opal "o": a ring (radius 120, hole 90 in a 240 box) with the top-right and bottom-left
/// corners squared off to a 30 radius. Same geometry as apps/web/src/lib/brand-paths.ts.
struct OpalMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 240
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * k, y: rect.minY + y * k) }
        var path = Path()
        // Outer shape, clockwise from the left.
        path.move(to: p(0, 120))
        path.addArc(center: p(120, 120), radius: 120 * k, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.addLine(to: p(210, 0))
        path.addArc(center: p(210, 30), radius: 30 * k, startAngle: .degrees(270), endAngle: .degrees(360), clockwise: false)
        path.addLine(to: p(240, 120))
        path.addArc(center: p(120, 120), radius: 120 * k, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        path.addLine(to: p(30, 240))
        path.addArc(center: p(30, 210), radius: 30 * k, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        path.closeSubpath()
        // Hole.
        path.addEllipse(in: CGRect(origin: p(30, 30), size: CGSize(width: 180 * k, height: 180 * k)))
        return path
    }
}

struct OpalMark: View {
    var size: CGFloat = 28
    var body: some View {
        OpalMarkShape()
            .fill(style: FillStyle(eoFill: true))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct UnlockView: View {
    @Environment(SessionStore.self) private var session
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            OpalMark()
            VStack(alignment: .leading, spacing: 4) {
                Text("Opal is private for now").font(.headline)
                Text("Enter the access password to continue.").font(.subheadline).foregroundStyle(.secondary)
            }
            SecureField("Access password", text: $password)
                .textContentType(.password)
                .padding(12)
                .background(.fill.tertiary, in: .rect(cornerRadius: 10))
                .onSubmit { Task { await session.unlock(password: password) } }
            if let error = session.error { Text(error).font(.footnote).foregroundStyle(.red) }
            Button {
                Task { await session.unlock(password: password) }
            } label: {
                Text("Unlock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
            .disabled(password.isEmpty || session.busy)
        }
        .padding(24)
        .frame(maxWidth: 380)
    }
}

struct LoginView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            OpalMark()
            Text("Sign in to Opal").font(.headline)
            Text("You'll sign in on the web, then come straight back here.")
                .font(.subheadline).foregroundStyle(.secondary)
            Button {
                session.signIn()
            } label: {
                Text("Continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(session.busy)
            if let error = session.error { Text(error).font(.footnote).foregroundStyle(.red) }
        }
        .padding(24)
        .frame(maxWidth: 380)
    }
}
