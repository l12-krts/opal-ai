import Foundation
import UIKit

/// Demo mode, for screenshots and UI tests: launched with `-demo`, the app answers every API call
/// from the canned data below instead of a server, and can open straight on a screen:
///
///     -demo -demoScreen code.thread      a pushed screen
///     -demo -demoScreen settings.memory  any settings page
///     -demo -demoSidebar                 with the sidebar out
///     -demo -demoOffline                 as if in airplane mode (every request fails)
///     -opal-theme dark                   (UserDefaults) the theme; -opal-accent blue the accent
enum Demo {
    static let enabled = ProcessInfo.processInfo.arguments.contains("-demo")

    static func flag(_ name: String) -> Bool { enabled && ProcessInfo.processInfo.arguments.contains(name) }

    static func value(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard enabled, let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// Where `-demoScreen` asks to start.
    @MainActor static var start: (route: Route, path: [Pushed])? {
        guard let screen = value("-demoScreen") else { return nil }
        switch screen {
        case "new": return (.chat(id: ChatModel.newId(), isNew: true, agentId: nil), [])
        case "chat": return (.chat(id: "demo-chat", isNew: false, agentId: nil), [])
        case "agent": return (.chat(id: "demo-agent-thread", isNew: false, agentId: "agent-scout"), [])
        case "agents": return (.agents, [])
        case "code": return (.code, [])
        case "code.thread": return (.code, [.codeThread("ct-1")])
        case "code.new": return (.code, [.newCodeThread])
        case "settings": return (.settings, [])
        case "customization": return (.customization, [])
        default:
            if screen.hasPrefix("settings."), let page = SettingsPage(rawValue: String(screen.dropFirst(9))) {
                return (SettingsPage.customization.contains(page) ? .customization : SettingsPage.code.contains(page) ? .code : .settings, [.settings(page)])
            }
            return nil
        }
    }
}

/// Answers `/api/...` requests in demo mode. Streams (chat replies, Code's live events) arrive
/// in pieces over time, like the real thing.
final class DemoURLProtocol: URLProtocol, @unchecked Sendable {
    private var stopped = false

    override class func canInit(with request: URLRequest) -> Bool {
        Demo.enabled && request.url?.path.hasPrefix("/api/") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func stopLoading() { stopped = true }

    override func startLoading() {
        guard let url = request.url else { return }
        // Airplane mode: every request fails the way it does on a phone with no connection.
        if Demo.flag("-demoOffline") {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let method = request.httpMethod ?? "GET"
        let path = url.path
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func q(_ name: String) -> String? { query.first { $0.name == name }?.value }

        // Streams first.
        if method == "POST" && path == "/api/chat" { return stream(DemoData.chatReply(), every: 0.05) }
        if method == "GET" && path.hasPrefix("/api/chat/") && path.hasSuffix("/stream") { return respond(204, "") }
        if path == "/api/code/events" { return hold() }

        let id = path.split(separator: "/").last.map(String.init) ?? ""
        switch (method, path) {
        case ("GET", "/api/settings"): return respond(200, DemoData.settings)
        case ("GET", "/api/conversations"): return respond(200, DemoData.conversations)
        case ("GET", _) where path.hasPrefix("/api/conversations/"): return respond(200, DemoData.conversation(id))
        case ("GET", "/api/agents"): return respond(200, DemoData.agents)
        case ("GET", _) where path.hasPrefix("/api/agents/") && path.hasSuffix("/thread"): return respond(200, #"{"threadId":"demo-agent-thread"}"#)
        case ("GET", _) where path.hasPrefix("/api/sandbox/"): return respond(200, DemoData.sandbox)
        case ("GET", "/api/code/state"): return respond(200, DemoData.codeState)
        case ("GET", _) where path.hasPrefix("/api/code/threads/") && path.hasSuffix("/git"): return respond(200, DemoData.git)
        case ("GET", _) where path.hasPrefix("/api/code/threads/"): return respond(200, DemoData.codeThread(id))
        case ("GET", "/api/code/settings"): return respond(200, DemoData.codeSettings)
        case ("GET", "/api/code/skills"): return respond(200, DemoData.codeSkills)
        case ("POST", "/api/code/machines"): return respond(200, DemoData.pairing)
        case ("GET", "/api/skills"): return respond(200, DemoData.skills)
        case ("GET", "/api/memory"): return respond(200, DemoData.memory)
        case ("GET", "/api/secrets"): return respond(200, DemoData.secrets)
        case ("GET", "/api/connectors"): return respond(200, DemoData.connectors(q("q")))
        case ("POST", "/api/connectors"): return respond(200, #"{"redirectUrl":"https://example.com"}"#)
        case ("GET", "/api/study/sources"): return respond(200, DemoData.studySources)
        case ("GET", "/api/study/browse"): return respond(200, DemoData.books)
        case ("GET", "/api/artifacts"): return respond(200, DemoData.artifacts)
        case ("GET", _) where path.hasPrefix("/api/artifacts/"): return respond(200, DemoData.artifact(id))
        case ("GET", "/api/handwriting/profiles"): return respond(200, DemoData.handwritingProfiles)
        case ("POST", "/api/handwriting/profiles"): return respond(200, #"{"profile":{"id":"h2","name":"New","glyphCount":0}}"#)
        case ("POST", "/api/attachments"): return respond(200, #"{"attachment":{"url":"/api/attachments/demo"}}"#)
        case ("GET", "/api/attachments/demo-cafes-pdf"): return respond(200, data: DemoData.cafesPDF(), type: "application/pdf")
        case ("POST", "/api/code/threads"): return respond(200, #"{"threads":["ct-1"]}"#)
        case ("GET", _): return respond(404, #"{"error":"not_found","message":"Not in the demo"}"#)
        default: return respond(200, #"{"ok":true}"#)
        }
    }

    private func respond(_ status: Int, data: Data, type: String) {
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private func respond(_ status: Int, _ body: String) {
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !body.isEmpty { client?.urlProtocol(self, didLoad: Data(body.utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }

    /// Sends Server-Sent Events one line at a time.
    private func stream(_ lines: [String], every interval: Double) {
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        let queue = DispatchQueue(label: "demo.stream")
        for (i, line) in lines.enumerated() {
            queue.asyncAfter(deadline: .now() + 0.35 + Double(i) * interval) { [self] in
                guard !stopped else { return }
                client?.urlProtocol(self, didLoad: Data("data: \(line)\n\n".utf8))
                if i == lines.count - 1 { client?.urlProtocolDidFinishLoading(self) }
            }
        }
    }

    /// A live-updates stream that stays open and quiet.
    private func hold() {
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(": open\n\n".utf8))
    }
}

/// The canned answers. Every name, address and account here is made up.
enum DemoData {
    /// The PDF the demo agent shares: a page drawn on the spot.
    static func cafesPDF() -> Data {
        let page = CGRect(x: 0, y: 0, width: 612, height: 792)
        return UIGraphicsPDFRenderer(bounds: page).pdfData { ctx in
            ctx.beginPage()
            let body: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.darkGray]
            NSAttributedString(string: "Cafés near the office", attributes: [.font: UIFont.systemFont(ofSize: 26, weight: .semibold)])
                .draw(at: CGPoint(x: 56, y: 64))
            let rows = [
                ("Field Notes Coffee", "92 Mbps · plugs at every window seat · quiet before 11"),
                ("Copper Kettle", "61 Mbps · plugs along the back wall · busy at lunch"),
                ("Lantern Roasters", "140 Mbps · a few plugs · open late"),
            ]
            for (i, row) in rows.enumerated() {
                let y = 130 + CGFloat(i) * 64
                NSAttributedString(string: row.0, attributes: [.font: UIFont.systemFont(ofSize: 17, weight: .medium)]).draw(at: CGPoint(x: 56, y: y))
                NSAttributedString(string: row.1, attributes: body).draw(at: CGPoint(x: 56, y: y + 24))
            }
        }
    }

    static func ago(_ seconds: Double) -> String {
        "\"" + Date().addingTimeInterval(-seconds).ISO8601Format() + "\""
    }

    static var settings: String {
        #"""
        {"user":{"name":"Alex Morgan","email":"alex@example.com"},
         "settings":{"model":null,"nerdMode":false,"memoryEnabled":true},
         "models":[
           {"id":"opal-auto","label":"Auto","providerLabel":"Opal","tier":true,"description":"Picks the right model for each message"},
           {"id":"opal-deep","label":"Deep","providerLabel":"Opal","tier":true,"description":"Thinks longer on hard problems"},
           {"id":"claude-sonnet-5-5","label":"Claude Sonnet 5.5","providerLabel":"Anthropic","tier":false,"description":null}
         ],
         "defaultModel":"opal-auto",
         "status":{"ai":true,"search":true,"connectors":true,"sandbox":false}}
        """#
    }

    static var conversations: String {
        #"""
        {"conversations":[
          {"id":"demo-chat","title":"How photosynthesis works","mode":"chat","agentId":null,"pinned":true,"updatedAt":\#(ago(600))},
          {"id":"c2","title":"A weekend in Lisbon","mode":"chat","agentId":null,"pinned":false,"updatedAt":\#(ago(5400))},
          {"id":"c3","title":"Biology chapter 3 summary","mode":"study","agentId":null,"pinned":false,"updatedAt":\#(ago(86000))},
          {"id":"c4","title":"Reply to the landlord","mode":"chat","agentId":null,"pinned":false,"updatedAt":\#(ago(190000))},
          {"id":"c5","title":"Rust lifetimes, explained","mode":"chat","agentId":null,"pinned":false,"updatedAt":\#(ago(400000))},
          {"id":"c6","title":"Weekly meal plan","mode":"chat","agentId":null,"pinned":false,"updatedAt":\#(ago(900000))}
        ]}
        """#
    }

    static let quizQuestions = #"""
        [{"question":"Where in the cell does photosynthesis happen?","options":["Mitochondria","Chloroplasts","Nucleus","Ribosomes"],"correctIndex":1,"explanation":"Chloroplasts hold chlorophyll, which captures the light."},
         {"question":"Which gas do plants take in for photosynthesis?","options":["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"],"correctIndex":2,"explanation":"CO2 from the air is turned into glucose."},
         {"question":"What does photosynthesis release?","options":["Oxygen","Methane","Carbon dioxide","Ammonia"],"correctIndex":0,"explanation":"Oxygen comes from splitting water."}]
        """#

    static func conversation(_ id: String) -> String {
        if id == "demo-agent-thread" {
            return #"""
            {"conversation":{"title":"Scout","mode":"chat"},
             "messages":[
              {"id":"am1","role":"user","parts":[{"type":"text","text":"Find three cafés near the office with good Wi-Fi and plugs."}],"metadata":null},
              {"id":"am2","role":"assistant","parts":[{"type":"text","text":"Here are three that fit, all within ten minutes on foot:\n\n1. **Field Notes Coffee**: fast Wi-Fi, plugs at every window seat, quiet before 11.\n2. **Copper Kettle**: big tables, plugs along the back wall, busy at lunch.\n3. **Lantern Roasters**: the fastest Wi-Fi I measured, but only a few plugs.\n\nI put them in a PDF with the speeds I measured:"},{"type":"tool-share_file","toolCallId":"sf1","state":"output-available","input":{"path":"cafes.pdf"},"output":{"ok":true,"file":{"id":"demo-cafes-pdf","name":"Cafés near the office.pdf","mediaType":"application/pdf","kind":"pdf","size":48213,"url":"/api/attachments/demo-cafes-pdf"}}},{"type":"text","text":"Want me to check opening hours for Saturday?"}],"metadata":{"model":"opal-auto"}}
             ]}
            """#
        }
        return #"""
        {"conversation":{"title":"How photosynthesis works","mode":"chat"},
         "messages":[
          {"id":"m1","role":"user","parts":[{"type":"text","text":"How does photosynthesis work? Keep it short."}],"metadata":null},
          {"id":"m2","role":"assistant","parts":[{"type":"text","text":"**Photosynthesis** is how plants turn light into food.\n\n1. Chlorophyll in the leaves absorbs sunlight.\n2. That energy splits water into oxygen and hydrogen.\n3. The hydrogen and carbon dioxide from the air become glucose.\n\n| Goes in | Comes out |\n| --- | --- |\n| Carbon dioxide, water, light | Glucose, oxygen |\n\nThe oxygen we breathe is a by-product."}],"metadata":{"model":"opal-auto"}},
          {"id":"m3","role":"user","parts":[{"type":"text","text":"Quiz me on it"}],"metadata":null},
          {"id":"m4","role":"assistant","parts":[{"type":"text","text":"Here's a short quiz. Tap an answer to check it."},{"type":"tool-create_quiz","toolCallId":"q1","state":"output-available","input":{"title":"Photosynthesis","questions":\#(quizQuestions)},"output":{"ok":true}}],"metadata":{"model":"opal-auto"}}
         ]}
        """#
    }

    /// A reply, split into small pieces so it streams in.
    static func chatReply() -> [String] {
        let text = "Good question. Plants keep making glucose as long as there's light, water and carbon dioxide. At night they switch to respiration and use some of that glucose for energy, which is why they release a little carbon dioxide after dark.\n\nSo in short: **photosynthesis stores energy, respiration spends it.**"
        var pieces: [String] = []
        var word = ""
        for ch in text {
            word.append(ch)
            if ch == " " || ch == "\n" { pieces.append(word); word = "" }
        }
        if !word.isEmpty { pieces.append(word) }
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
        }
        let id = "reply-\(Int(Date().timeIntervalSince1970))"
        var lines = [#"{"type":"start","messageId":"\#(id)","messageMetadata":{"model":"opal-auto"}}"#, #"{"type":"text-start","id":"t1"}"#]
        lines += pieces.map { #"{"type":"text-delta","id":"t1","delta":"\#(esc($0))"}"# }
        lines += [#"{"type":"text-end","id":"t1"}"#, #"{"type":"finish"}"#, "[DONE]"]
        return lines
    }

    static var agents: String {
        #"""
        {"agents":[
          {"id":"agent-scout","name":"Scout","color":"#3b82f6","shape":"ghost","threadId":"demo-agent-thread","preview":"Here are three that fit, all within ten minutes on foot.","running":false,"activityAt":\#(ago(1200))},
          {"id":"agent-atlas","name":"Atlas","color":"#22a35a","shape":"cookie","threadId":"t-atlas","preview":"Reading this week's newsletters","running":true,"activityAt":\#(ago(90))},
          {"id":"agent-quill","name":"Quill","color":"#8b5cf6","shape":"clover","threadId":null,"preview":null,"running":false,"activityAt":null}
        ]}
        """#
    }

    static let sandbox = #"{"sandbox":{"status":"running","lastUrl":"https://example.com/cafes","lastScreenshot":null,"files":[{"type":"file","path":"cafes.md","size":1840}]}}"#

    static var codeState: String {
        #"""
        {"machines":[
           {"id":"m1","name":"Studio","os":"linux","hostname":"studio","online":true,"projectsRoot":"/home/alex/Projects","lastSeenAt":\#(ago(5)),
            "agents":[{"id":"claude","version":"2.1.4","ok":true,"note":null,"signedIn":true},{"id":"codex","version":null,"ok":false,"note":"Codex isn't installed on this machine.","signedIn":null}]},
           {"id":"m2","name":"Pi","os":"linux","hostname":"umbrel","online":false,"projectsRoot":"/home/umbrel/Projects","lastSeenAt":\#(ago(10800)),
            "agents":[{"id":"claude","version":"2.1.2","ok":true,"note":null,"signedIn":true}]}
         ],
         "projects":[
           {"id":"p1","machineId":"m1","name":"opal-ai","path":"/home/alex/Projects/opal-ai","isGit":true},
           {"id":"p2","machineId":"m1","name":"blog","path":"/home/alex/Projects/blog","isGit":true},
           {"id":"p3","machineId":"m2","name":"home-automation","path":"/home/umbrel/Projects/home-automation","isGit":false}
         ],
         "threads":[
           \#(thread("ct-1", title: "Fix the flaky login test", status: "waiting", project: "p1", branch: "opal/fix-login-test", preview: "Wants to run npm test -- login --runInBand", activity: 120, read: nil)),
           \#(thread("ct-2", title: "Add dark mode to the blog", status: "working", project: "p2", branch: "opal/dark-mode", preview: "Editing src/styles/theme.css", activity: 30, read: nil)),
           \#(thread("ct-3", title: "Bump dependencies", status: "idle", project: "p1", branch: "opal/bump-deps", preview: "All 214 tests pass. Opened a pull request.", activity: 3600, read: nil, pr: "https://github.com/example/opal-ai/pull/42")),
           \#(thread("ct-4", title: "Write a README for home-automation", status: "idle", project: "p3", branch: nil, preview: "Added README.md with setup steps.", activity: 86000, read: 80000)),
           \#(thread("ct-5", title: "Try the new router", status: "idle", project: "p2", branch: nil, preview: "Done.", activity: 400000, read: 300000, settled: true))
         ]}
        """#
    }

    private static func thread(_ id: String, title: String, status: String, project: String, branch: String?, preview: String, activity: Double, read: Double?, pr: String? = nil, settled: Bool = false) -> String {
        let machine = project == "p3" ? "m2" : "m1"
        let b = branch.map { "\"\($0)\"" } ?? "null"
        let r = read.map { ago($0) } ?? "null"
        let p = pr.map { "\"\($0)\"" } ?? "null"
        let s = settled ? ago(200000) : "null"
        return #"""
        {"id":"\#(id)","title":"\#(title)","agent":"claude","model":null,"mode":"auto","status":"\#(status)","machineId":"\#(machine)","projectId":"\#(project)","cwd":"/home/alex/Projects","branch":\#(b),"worktree":\#(branch != nil),"prUrl":\#(p),"pinnedAt":null,"snoozedUntil":null,"settledAt":\#(s),"lastReadAt":\#(r),"lastActivityAt":\#(ago(activity)),"preview":"\#(preview)"}
        """#
    }

    static func codeThread(_ id: String) -> String {
        let t = codeState
        // The thread itself comes from the same list as the inbox.
        let start = t.range(of: "{\"id\":\"\(id)\"") ?? t.range(of: "{\"id\":\"ct-1\"")!
        let rest = t[start.lowerBound...]
        let end = rest.range(of: "}")!
        let threadJSON = String(rest[..<end.upperBound])
        return #"""
        {"thread":\#(threadJSON),
         "items":[
          {"id":"i1","seq":1,"kind":"user","text":"The login test fails about one run in five. Find out why and fix it."},
          {"id":"i2","seq":2,"kind":"assistant","text":"I'll run the test a few times to see how it fails."},
          {"id":"i3","seq":3,"kind":"command","command":"npm test -- login","status":"failed","exitCode":1,"output":"FAIL src/auth/login.test.ts\n  ✕ signs in with a valid password (5012 ms)\n\n  Timeout: the session cookie never arrived.\n\nTests: 1 failed, 11 passed"},
          {"id":"i4","seq":4,"kind":"assistant","text":"The test reads the session before the sign-in request finishes. It passes when the request is fast and fails when it's slow. I'll wait for the response instead of a fixed delay."},
          {"id":"i5","seq":5,"kind":"edit","status":"done","files":[{"path":"src/auth/login.test.ts","change":"update","diff":"@@ -18,9 +18,9 @@ describe(\"login\", () => {\n   it(\"signs in with a valid password\", async () => {\n     await page.fill(\"#email\", user.email);\n     await page.fill(\"#password\", user.password);\n-    await page.click(\"button[type=submit]\");\n-    await page.waitForTimeout(500);\n+    await Promise.all([page.waitForResponse(\"**/api/auth/sign-in\"), page.click(\"button[type=submit]\")]);\n     expect(await session(page)).toBeTruthy();\n   });"}]},
          {"id":"i6","seq":6,"kind":"approval","status":"pending","title":"Run a command","detail":"Runs the login test 20 times in a row to check it's stable.","command":"npm test -- login --runInBand --repeat 20","requestId":"r1"}
         ]}
        """#
    }

    static let git = #"""
        {"status":{"branch":"opal/fix-login-test","base":"main","ahead":1,"behind":0,"dirty":true,"hasRemote":true,
                   "files":[{"path":"src/auth/login.test.ts","status":"M","additions":1,"deletions":2}]},
         "diff":"diff --git a/src/auth/login.test.ts b/src/auth/login.test.ts\nindex 3f2a1c4..8b9d0e2 100644\n--- a/src/auth/login.test.ts\n+++ b/src/auth/login.test.ts\n@@ -18,9 +18,9 @@ describe(\"login\", () => {\n   it(\"signs in with a valid password\", async () => {\n     await page.fill(\"#email\", user.email);\n     await page.fill(\"#password\", user.password);\n-    await page.click(\"button[type=submit]\");\n-    await page.waitForTimeout(500);\n+    await Promise.all([page.waitForResponse(\"**/api/auth/sign-in\"), page.click(\"button[type=submit]\")]);\n     expect(await session(page)).toBeTruthy();\n   });",
         "truncated":false,"prUrl":null}
        """#

    static let codeSettings = #"{"settings":{"defaultAgent":"claude","defaultMode":"auto","worktreeByDefault":true,"settleDays":3}}"#

    static let pairing = #"""
        {"code":"K7PQ-M2XD","expiresAt":"2030-01-01T00:00:00Z","origins":[{"origin":"https://opal.example.ts.net","label":"Tailscale"},{"origin":"http://192.168.1.20:3000","label":"Local network"}],"appImage":["x86_64","aarch64"]}
        """#

    static let codeSkills = #"""
        {"skills":[
          {"id":"cs1","name":"Review","description":"Review the current changes before I commit","instructions":"Review the uncommitted changes (git diff) as a strict senior reviewer.","enabled":true},
          {"id":"cs2","name":"Ship","description":"Typecheck, test, then commit with a clear message","instructions":"1. Run the project's typecheck and tests; fix what fails.","enabled":false}
        ]}
        """#

    static let skills = #"""
        {"skills":[
          {"id":"s1","name":"Exam prep","description":"When I'm preparing for a test or exam","instructions":"1. If I didn't say, ask for the subject, the chapters and the exam date.","enabled":true}
        ]}
        """#

    static var memory: String {
        #"""
        {"memories":[
          {"id":"mem1","content":"Studies biology in the second year of university.","source":"opal","createdAt":\#(ago(86400 * 3))},
          {"id":"mem2","content":"Prefers short answers with one example.","source":"user","createdAt":\#(ago(86400 * 9))},
          {"id":"mem3","content":"Writes emails in Greek to the university and in English at work.","source":"opal","createdAt":\#(ago(86400 * 20))},
          {"id":"mem4","content":"Vegetarian; cooks for two on weekdays.","source":"opal","createdAt":\#(ago(86400 * 40))}
        ]}
        """#
    }

    static var secrets: String {
        #"""
        {"secrets":[
          {"name":"GITHUB_TOKEN","label":"GitHub token","description":"Lets agents open pull requests","updatedAt":\#(ago(86400 * 12)),"lastUsedAt":\#(ago(7200))},
          {"name":"ECLASS_PASSWORD","label":"eClass password","description":"Used by the Study AI to read your eClass","updatedAt":\#(ago(86400 * 30)),"lastUsedAt":null}
        ]}
        """#
    }

    static func connectors(_ query: String?) -> String {
        let all: [(slug: String, name: String, connected: Bool, noAuth: Bool)] = [
            ("gmail", "Gmail", true, false), ("github", "GitHub", true, false), ("googlecalendar", "Google Calendar", false, false),
            ("notion", "Notion", false, false), ("slack", "Slack", false, false), ("linear", "Linear", false, false),
            ("hackernews", "Hacker News", false, true),
        ]
        let q = (query ?? "").lowercased()
        let list = all.filter { q.isEmpty || $0.name.lowercased().contains(q) }.map { t in
            #"{"slug":"\#(t.slug)","name":"\#(t.name)","logo":null,"connected":\#(t.connected),"connectedAccountId":\#(t.connected ? "\"acc-\(t.slug)\"" : "null"),"noAuth":\#(t.noAuth)}"#
        }
        return #"{"enabled":true,"toolkits":[\#(list.joined(separator: ","))]}"#
    }

    static let studySources = #"{"sources":[{"kind":"eclass","label":"eclass.uoa.gr","config":{"baseUrl":"https://eclass.uoa.gr","username":"alexm"}}]}"#

    static let books = #"""
        {"items":[
          {"id":"ebooks:K10:biology","title":"Βιολογία Α΄ Λυκείου","subtitle":"Γενικής Παιδείας"},
          {"id":"ebooks:K10:chemistry","title":"Χημεία Α΄ Λυκείου","subtitle":null},
          {"id":"ebooks:K10:physics","title":"Φυσική Α΄ Λυκείου","subtitle":null},
          {"id":"ebooks:K10:algebra","title":"Άλγεβρα Α΄ Λυκείου","subtitle":"και Στοιχεία Πιθανοτήτων"},
          {"id":"ebooks:K10:history","title":"Ιστορία Α΄ Λυκείου","subtitle":null}
        ]}
        """#

    static var artifacts: String {
        #"""
        {"artifacts":[
          {"id":"a1","kind":"quiz","title":"Photosynthesis","createdAt":\#(ago(600))},
          {"id":"a2","kind":"flashcards","title":"Cell organelles","createdAt":\#(ago(86400 * 2))}
        ]}
        """#
    }

    static func artifact(_ id: String) -> String {
        if id == "a2" {
            return #"""
            {"artifact":{"kind":"flashcards","title":"Cell organelles","data":{"cards":[
              {"front":"Mitochondria","back":"Make the cell's energy (ATP)."},
              {"front":"Ribosome","back":"Builds proteins."},
              {"front":"Chloroplast","back":"Runs photosynthesis in plant cells."}
            ]}}}
            """#
        }
        return #"{"artifact":{"kind":"quiz","title":"Photosynthesis","data":{"questions":\#(quizQuestions)}}}"#
    }

    static let handwritingProfiles = #"{"profiles":[{"id":"h1","name":"My handwriting","glyphCount":0}]}"#
}
