import Foundation
import Network
import Observation
import SwiftUI

/// Whether the phone can reach the internet, for the offline banner and for catching up when the
/// connection comes back. Also turns network errors into words.
@MainActor
@Observable
final class Connectivity {
    static let shared = Connectivity()

    private(set) var online = true
    /// Bumped each time the connection comes back, for whoever was waiting on it.
    private(set) var reconnects = 0
    @ObservationIgnored private let monitor = NWPathMonitor()

    private init() {
        // Screenshots of the offline state.
        if Demo.flag("-demoOffline") { online = false; return }
        monitor.pathUpdateHandler = { path in
            let ok = path.status == .satisfied
            Task { @MainActor in Connectivity.shared.update(ok) }
        }
        monitor.start(queue: DispatchQueue(label: "app.opal.connectivity"))
    }

    private func update(_ ok: Bool) {
        guard ok != online else { return }
        withAnimation(Motion.morph) { online = ok }
        if ok { reconnects += 1 }
    }

    /// Shown where a reply was cut off by the connection.
    static let offlineReply = "You're offline. Opal keeps working on it and the reply shows up here when you're back."

    /// A failure of the connection (offline, dropped, timed out, server unreachable) rather
    /// than an answer from the server.
    nonisolated static func isNetwork(_ error: any Error) -> Bool {
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost,
                 .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff, .callIsActive, .secureConnectionFailed,
                 .resourceUnavailable, .backgroundSessionWasDisconnected, .cannotLoadFromNetwork:
                return true
            default:
                return false
            }
        }
        let ns = error as NSError
        return ns.domain == NSPOSIXErrorDomain
    }

    /// What to tell you about a request that failed.
    nonisolated static func describe(_ error: any Error) -> String {
        if let e = error as? APIError { return e.message }
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
                return "You're offline."
            case .timedOut:
                return "Opal took too long to answer."
            case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return "Can't reach Opal. Check your connection, or that the server is running."
            case .networkConnectionLost:
                return "The connection dropped."
            default:
                break
            }
        }
        return error.localizedDescription
    }
}

/// "You're offline" under the header, while there's no connection.
struct OfflineBanner: View {
    var body: some View {
        if !Connectivity.shared.online {
            Label("You're offline", systemImage: "wifi.slash")
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 14)
                .frame(height: 34)
                .opalGlass(in: Capsule())
                .transition(.move(edge: .top).combined(with: .opacity))
                .accessibilityAddTraits(.isStaticText)
        }
    }
}
