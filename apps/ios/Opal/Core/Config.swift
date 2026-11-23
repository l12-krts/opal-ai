import Foundation

enum Config {
    /// Read from Info.plist (set per build configuration in project.yml).
    static let baseURL: URL = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "OpalBaseURL") as? String ?? "https://app.opal.example"
        return URL(string: raw)!
    }()

    static let callbackScheme = "opal"
}
