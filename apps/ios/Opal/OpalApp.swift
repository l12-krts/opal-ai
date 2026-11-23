import SwiftUI

@main
struct OpalApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(Color.accentColor)
        }
    }
}
