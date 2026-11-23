import Foundation

enum Config {
    /// Read from Info.plist (set per build configuration in project.yml).
    static let baseURL: URL = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "OpalBaseURL") as? String ?? "https://opal.tailefea70.ts.net"
        return URL(string: raw)!
    }()

    static let callbackScheme = "opal"
}
