import SwiftUI

@main
struct OpalApp: App {
    @State private var session = SessionStore()

    init() {
        // Screenshots and UI tests run against canned answers instead of a server.
        if Demo.enabled { URLProtocol.registerClass(DemoURLProtocol.self) }
    }

    var body: some Scene {
        WindowGroup {
            let accent = AccentPalette(session.accent)
            RootView()
                // A tap outside the keyboard puts it away, everywhere.
                .background(KeyboardDismissInstaller())
                .environment(session)
                .environment(\.accent, accent)
                .tint(accent.line)
                .toggleStyle(OpalSwitchStyle())
                .preferredColorScheme(session.theme.colorScheme)
        }
    }
}
