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

    private(set) var phase: Phase
    private(set) var userName: String?
    var error: String?
    var busy = false

    private(set) var gateToken: String? = Keychain.get("gate")
    private(set) var sessionToken: String? = Keychain.get("session")
    private var authSession: ASWebAuthenticationSession?

    override init() {
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

    func loadUser() async {
        struct Settings: Decodable { struct User: Decodable { let name: String }; let user: User }
        do {
            userName = try await api.send("/api/settings", as: Settings.self).user.name
        } catch let e as APIError where e.status == 401 {
            handleUnauthorized(e)
        } catch {}
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
