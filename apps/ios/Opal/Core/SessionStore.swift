import AuthenticationServices
import Foundation
import Observation
import UIKit

/// Site lock + sign-in state.
///
/// Sign-in runs in ASWebAuthenticationSession (Google doesn't allow embedded web views):
/// it opens <server>/desktop/login, the user signs in on the web, and the page redirects to
/// opal://auth?token=<one-time token>. We trade that token for a session token, which goes in
/// the Keychain and is sent as `Authorization: Bearer` from then on.
@MainActor
@Observable
final class SessionStore: NSObject {
    enum Phase { case locked, signedOut, signedIn }

    /// What the server can do right now (Settings → Status).
    struct ServiceStatus: Decodable, Equatable {
        var ai = false
        var search = false
        var connectors = false
        var sandbox = false
    }

    private(set) var phase: Phase
    private(set) var userName: String?
    private(set) var email: String?
    /// Models the composer can pick, and the one used when none is picked.
    private(set) var models: [ModelInfo] = []
    private(set) var defaultModelId: String?
    /// The account's own choice of model (nil: Opal picks).
    private(set) var chosenModelId: String?
    private(set) var serverDefaultModelId: String?
    private(set) var status: ServiceStatus?
    /// Settings, mirrored from /api/settings. Theme and accent are also kept on the device so the
    /// app opens in the right colours before the server answers.
    private(set) var theme: ThemePreference = ThemePreference(rawValue: UserDefaults.standard.string(forKey: "opal-theme") ?? "") ?? .system
    private(set) var accent: AccentID = AccentID(rawValue: UserDefaults.standard.string(forKey: "opal-accent") ?? "") ?? .default
    private(set) var nerdMode = UserDefaults.standard.bool(forKey: "opal-nerd")
    private(set) var memoryEnabled = true
    var error: String?
    var busy = false

    private(set) var gateToken: String? = Keychain.get("gate")
    private(set) var sessionToken: String? = Keychain.get("session")
    private var authSession: ASWebAuthenticationSession?

    override init() {
        if Demo.enabled {
            gateToken = "demo"
            sessionToken = "demo"
            phase = .signedIn
            super.init()
            return
        }
        let gate = Keychain.get("gate")
        let session = Keychain.get("session")
        phase = gate == nil ? .locked : (session == nil ? .signedOut : .signedIn)
        super.init()
    }

    var api: APIClient {
        let gate = gateToken
        let session = sessionToken
        return APIClient(gateToken: { gate }, sessionToken: { session })
    }

    func unlock(password: String) async {
        busy = true
        defer { busy = false }
        struct Body: Encodable { let password: String }
        struct Res: Decodable { let token: String }
        do {
            let res = try await APIClient(gateToken: { nil }, sessionToken: { nil })
                .send("/api/gate", method: "POST", json: Body(password: password), as: Res.self)
            gateToken = res.token
            Keychain.set(res.token, for: "gate")
            phase = sessionToken == nil ? .signedOut : .signedIn
            error = nil
        } catch {
            self.error = (error as? APIError)?.status == 401 ? "That password is not right" : error.localizedDescription
        }
    }

    func signIn() {
        error = nil
        let url = Config.baseURL.appending(path: "/desktop/login")
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Config.callbackScheme) { [weak self] callback, err in
            Task { @MainActor in
                guard let self else { return }
                if let err {
                    if (err as? ASWebAuthenticationSessionError)?.code != .canceledLogin { self.error = err.localizedDescription }
                    return
                }
                guard let callback,
                      let token = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "token" })?.value
                else { self.error = "Sign-in didn't complete"; return }
                await self.exchange(oneTimeToken: token)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }

    private func exchange(oneTimeToken: String) async {
        busy = true
        defer { busy = false }
        struct Body: Encodable { let token: String }
        do {
            let (_, http) = try await api.sendRaw("/api/auth/one-time-token/verify", json: Body(token: oneTimeToken))
            guard let token = http.value(forHTTPHeaderField: "set-auth-token") else {
                error = "The server didn't return a session"
                return
            }
            sessionToken = token
            Keychain.set(token, for: "session")
            phase = .signedIn
            await loadUser()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private struct UserResponse: Decodable {
        struct User: Decodable { let name: String; let email: String? }
        struct S: Decodable {
            let model: String?
            let nerdMode: Bool?
            let theme: String?
            let accent: String?
            let memoryEnabled: Bool?
        }
        let user: User
        let settings: S?
        let models: [ModelInfo]?
        let defaultModel: String?
        let status: ServiceStatus?
    }

    /// Your name, models and settings: the copy kept from last time first (so the app is
    /// filled in straight away, and offline), then the server's.
    func loadUser() async {
        if userName == nil, let cached = api.cached("/api/settings", as: UserResponse.self) {
            apply(cached)
        }
        do {
            apply(try await api.send("/api/settings", as: UserResponse.self, cache: true))
        } catch let e as APIError where e.status == 401 {
            handleUnauthorized(e)
        } catch {}
    }

    private func apply(_ res: UserResponse) {
        userName = res.user.name
        email = res.user.email
        models = res.models ?? []
        chosenModelId = res.settings?.model
        serverDefaultModelId = res.defaultModel
        defaultModelId = res.settings?.model ?? res.defaultModel
        status = res.status
        if let s = res.settings {
            if let v = s.nerdMode { nerdMode = v; UserDefaults.standard.set(v, forKey: "opal-nerd") }
            if let v = s.theme.flatMap(ThemePreference.init(rawValue:)) { theme = v; UserDefaults.standard.set(v.rawValue, forKey: "opal-theme") }
            if let v = s.accent.flatMap(AccentID.init(rawValue:)) { accent = v; UserDefaults.standard.set(v.rawValue, forKey: "opal-accent") }
            if let v = s.memoryEnabled { memoryEnabled = v }
        }
    }

    // MARK: Settings

    func setAccent(_ value: AccentID) {
        accent = value
        UserDefaults.standard.set(value.rawValue, forKey: "opal-accent")
        patchSettings(["accent": .string(value.rawValue)])
    }

    func setTheme(_ value: ThemePreference) {
        theme = value
        UserDefaults.standard.set(value.rawValue, forKey: "opal-theme")
        patchSettings(["theme": .string(value.rawValue)])
    }

    func setNerdMode(_ value: Bool) {
        nerdMode = value
        UserDefaults.standard.set(value, forKey: "opal-nerd")
        patchSettings(["nerdMode": .bool(value)])
    }

    func setMemoryEnabled(_ value: Bool) {
        memoryEnabled = value
        patchSettings(["memoryEnabled": .bool(value)])
    }

    /// nil lets Opal pick.
    func setDefaultModel(_ id: String?) {
        chosenModelId = id
        defaultModelId = id ?? serverDefaultModelId
        patchSettings(["model": id.map(JSONValue.string) ?? .null])
    }

    private func patchSettings(_ body: [String: JSONValue]) {
        let api = api
        Task { _ = try? await api.sendRaw("/api/settings", method: "PATCH", json: JSONValue.object(body)) }
    }

    func handleUnauthorized(_ e: APIError) {
        if e.code == "locked" {
            gateToken = nil
            Keychain.set(nil, for: "gate")
            phase = .locked
        } else {
            sessionToken = nil
            Keychain.set(nil, for: "session")
            phase = .signedOut
        }
    }

    func signOut() {
        Task { _ = try? await api.sendRaw("/api/auth/sign-out", json: [String: String]()) }
        sessionToken = nil
        Keychain.set(nil, for: "session")
        // Chats and settings kept on the phone go with the account.
        ResponseCache.clear()
        phase = .signedOut
    }
}

extension SessionStore: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
