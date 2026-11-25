import XCTest

/// Opens every screen in demo mode (canned data, no server) and saves a screenshot of each, so
/// the UI can be checked without a device. Each one is attached to the test results, and when
/// SCREENSHOTS_DIR is set (TEST_RUNNER_SCREENSHOTS_DIR on the xcodebuild command line) also
/// written there as a PNG.
@MainActor
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ args: [String], theme: String = "light", accent: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-opal-theme", theme] + (accent.map { ["-opal-accent", $0] } ?? []) + args
        app.launch()
        return app
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SCREENSHOTS_DIR"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("\(name).png")
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: url)
        }
    }

    private func settle(_ seconds: TimeInterval = 2.2) {
        Thread.sleep(forTimeInterval: seconds)
    }

    /// Runs first (tests run in name order): the first launch on a fresh CI simulator is slow and
    /// sometimes loses its connection, so let that happen here rather than in a real test.
    func test0WarmUp() {
        let app = launch(["-demoScreen", "new"])
        settle(4)
        app.terminate()
    }

    /// Every main screen and settings page, light and dark.
    func testScreens() {
        let screens: [(String, [String])] = [
            ("new", ["-demoScreen", "new"]),
            ("chat", ["-demoScreen", "chat"]),
            ("agent-chat", ["-demoScreen", "agent"]),
            ("agents", ["-demoScreen", "agents"]),
            ("code", ["-demoScreen", "code"]),
            ("code-thread", ["-demoScreen", "code.thread"]),
            ("code-new", ["-demoScreen", "code.new"]),
            ("settings", ["-demoScreen", "settings"]),
            ("customization", ["-demoScreen", "customization"]),
            ("sidebar", ["-demoScreen", "chat", "-demoSidebar"]),
        ]
        for theme in ["light", "dark"] {
            for (name, args) in screens {
                let app = launch(args, theme: theme)
                settle()
                snap(app, "\(theme)/\(name)")
                app.terminate()
            }
        }
    }

    func testSettingsPages() {
        let pages = ["general", "study", "handwriting", "secrets", "memory", "skills", "connectors", "codeGeneral", "codeMachines", "codeProjects", "codeSkills"]
        for page in pages {
            let app = launch(["-demoScreen", "settings.\(page)"], theme: page.hasPrefix("code") ? "dark" : "light")
            settle()
            snap(app, "settings/\(page)")
            if page == "handwriting" || page == "study" {
                app.swipeUp()
                settle(1)
                snap(app, "settings/\(page)-2")
            }
            app.terminate()
        }
        // The accent follows the pick everywhere (buttons, checkmarks, the cursor).
        for accent in ["blue", "pink"] {
            let app = launch(["-demoScreen", "settings.general"], theme: "dark", accent: accent)
            settle()
            snap(app, "settings/general-\(accent)")
            app.terminate()
        }
    }

    /// The composer's + menu, opened by tapping "+" the way you do: it must sit above the
    /// composer, and the camera panel must stay on screen.
    func testMenuTapped() {
        for theme in ["light", "dark"] {
            let app = launch(["-demoScreen", "chat"], theme: theme)
            settle()
            let plus = app.buttons["Add files and more"].firstMatch
            guard plus.waitForExistence(timeout: 5) else { XCTFail("No + button"); app.terminate(); continue }
            plus.tap()
            settle(1)
            snap(app, "menu/\(theme)-open")
            let camera = app.buttons["Camera"].firstMatch
            if camera.waitForExistence(timeout: 3) {
                camera.tap()
                settle(1.2)
                snap(app, "menu/\(theme)-camera")
            }
            app.terminate()
            guard theme == "light" else { continue }
            // A row tap must land: Study turns on and shows as a chip in the composer.
            let again = launch(["-demoScreen", "chat"], theme: theme)
            settle()
            again.buttons["Add files and more"].firstMatch.tap()
            settle(1)
            // The row's label includes its subtitle ("Study, Your books…").
            let study = again.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Study'")).firstMatch
            if study.waitForExistence(timeout: 3) {
                study.tap()
                settle(1)
                snap(again, "menu/study-picked")
                XCTAssertTrue(again.buttons["Turn off Study"].waitForExistence(timeout: 3), "Tapping Study in the + menu did nothing")
            }
            again.terminate()
        }
    }

    /// Sending: the message flies up from the composer, then the reply streams in under it.
    func testSending() {
        let app = launch(["-demoScreen", "chat"])
        settle()
        let field = app.descendants(matching: .any)["composer"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        snap(app, "send/0-idle")
        field.tap()
        settle(0.8)
        snap(app, "send/1-focused")
        field.typeText("What happens at night?")
        app.buttons["Send"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 0.12)
        snap(app, "send/2-flight")
        Thread.sleep(forTimeInterval: 0.6)
        snap(app, "send/3-streaming")
        settle(1.2)
        snap(app, "send/4-streaming-later")
        settle(4)
        snap(app, "send/5-done")
        app.terminate()

        // A new chat: the composer must be the same width focused or not.
        let fresh = launch(["-demoScreen", "new"])
        settle()
        snap(fresh, "send/new-unfocused")
        let f2 = fresh.descendants(matching: .any)["composer"].firstMatch
        if f2.waitForExistence(timeout: 5) {
            f2.tap()
            settle(1)
            snap(fresh, "send/new-focused")
            // A tap above the keyboard (on the greeting) puts it away.
            fresh.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
            settle(1)
            snap(fresh, "send/new-tapped-away")
            XCTAssertFalse(fresh.keyboards.firstMatch.exists, "The keyboard stayed up after tapping outside it")
        }
        fresh.terminate()
    }

    /// Airplane mode: the chat shows what the phone kept from last time, a banner says you're
    /// offline, and a message that can't go out says so (with Try again).
    func testOffline() {
        // Once online, so the phone keeps a copy of the chat and the list.
        let online = launch(["-demoScreen", "chat"])
        settle()
        online.terminate()

        let app = launch(["-demoScreen", "chat", "-demoOffline"])
        settle()
        snap(app, "offline/chat")
        let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "You're offline")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 3), "No offline banner")
        let field = app.descendants(matching: .any)["composer"].firstMatch
        if field.waitForExistence(timeout: 5) {
            field.tap()
            field.typeText("Are you there?")
            app.buttons["Send"].firstMatch.tap()
            settle(1.5)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
            settle(1)
            snap(app, "offline/sent")
            // The error row reads as one element ("You're offline., Try again").
            let error = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "offline.")).firstMatch
            XCTAssertTrue(error.waitForExistence(timeout: 3), "Sending offline said nothing")
        }
        app.terminate()

        // A new chat offline.
        let fresh = launch(["-demoScreen", "new", "-demoOffline"], theme: "dark")
        settle()
        snap(fresh, "offline/new")
        fresh.terminate()
    }

    /// A file an agent attached from its computer: the card in its answer, then Quick Look.
    func testSharedFile() {
        for theme in ["light", "dark"] {
            let app = launch(["-demoScreen", "agent"], theme: theme)
            settle()
            snap(app, "files/\(theme)-card")
            let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Cafés")).firstMatch
            if card.waitForExistence(timeout: 5) {
                card.tap()
                // It downloads, then Quick Look draws the page out of process: give it time.
                settle(6)
                snap(app, "files/\(theme)-quicklook")
            } else {
                XCTFail("No card for the shared file")
            }
            app.terminate()
        }
    }

    /// The sidebar sliding out, a few frames in.
    func testSidebarMotion() {
        let app = launch(["-demoScreen", "chat"])
        settle()
        let button = app.buttons["Open sidebar"].firstMatch
        guard button.waitForExistence(timeout: 5) else { return XCTFail("No sidebar button") }
        // XCUITest waits for animations to finish before a screenshot, so only the end state.
        button.tap()
        settle(1)
        snap(app, "sidebar/open-done")
        app.terminate()
    }

    /// Sheets: a code thread's changes, and pairing a machine.
    func testSheets() {
        let app = launch(["-demoScreen", "code.thread"], theme: "dark")
        settle()
        let changes = app.buttons["Changes"].firstMatch
        if changes.waitForExistence(timeout: 5) {
            changes.tap()
            settle(1.5)
            snap(app, "sheets/git")
        }
        app.terminate()

        let machines = launch(["-demoScreen", "settings.codeMachines"])
        settle()
        let connect = machines.buttons["Connect a machine"].firstMatch
        if connect.waitForExistence(timeout: 5) {
            connect.tap()
            settle(1.5)
            snap(machines, "sheets/pair")
        }
        machines.terminate()

        let agents = launch(["-demoScreen", "agents"])
        settle()
        let add = agents.buttons["New agent"].firstMatch
        if add.waitForExistence(timeout: 3) {
            add.tap()
            settle(1.2)
            snap(agents, "sheets/new-agent")
        }
        agents.terminate()
    }

    /// Documents (docs, slides, sheets, charts, whiteboards): their cards in a chat, each one
    /// opened full screen, and the Documents page.
    func testDocuments() {
        for theme in ["light", "dark"] {
            let app = launch(["-demoScreen", "docs"], theme: theme)
            settle(3)
            snap(app, "docs/\(theme)-chat-1")
            for i in 2...4 {
                app.swipeDown()
                settle(1)
                snap(app, "docs/\(theme)-chat-\(i)")
            }
            app.terminate()
        }

        for kind in ["doc", "sheet", "slides", "chart", "whiteboard"] {
            let app = launch(["-demoScreen", "docs"], theme: kind == "chart" ? "dark" : "light")
            settle(3)
            let card = app.buttons["document-\(kind)"].firstMatch
            guard card.waitForExistence(timeout: 5) else {
                XCTFail("No \(kind) card")
                app.terminate()
                continue
            }
            // Scroll it clear of the header and the composer, in short drags, then tap it.
            let height = app.frame.height
            for _ in 0..<12 {
                let f = card.frame
                let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                if f.minY < 150 {
                    middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: min(280, 170 - f.minY))))
                } else if f.maxY > height - 130 {
                    middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: -min(280, f.maxY - (height - 150)))))
                } else {
                    break
                }
                settle(0.8)
            }
            card.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            settle(2)
            snap(app, "docs/open-\(kind)")
            XCTAssertTrue(app.navigationBars.buttons["Done"].firstMatch.waitForExistence(timeout: 3), "Tapping the \(kind) card didn't open it")
            if kind == "slides" {
                app.swipeLeft()
                settle(1)
                snap(app, "docs/open-slides-2")
            }
            if kind == "sheet" {
                // The total (a formula) is only in the full-screen grid; the card shows the first rows.
                let total = app.staticTexts["€673.60"].firstMatch
                if total.waitForExistence(timeout: 2) {
                    total.tap()
                    settle(0.6)
                    snap(app, "docs/open-sheet-cell")
                }
            }
            app.terminate()
        }

        for theme in ["light", "dark"] {
            let app = launch(["-demoScreen", "documents"], theme: theme)
            settle(3)
            snap(app, "docs/\(theme)-page")
            app.terminate()
        }
        let page = launch(["-demoScreen", "documents"])
        settle(3)
        let tile = page.buttons["document-tile-whiteboard"].firstMatch
        if tile.waitForExistence(timeout: 5) {
            tile.tap()
            settle(2)
            snap(page, "docs/page-open-whiteboard")
        } else {
            XCTFail("No whiteboard on the Documents page")
        }
        page.terminate()
    }
}
