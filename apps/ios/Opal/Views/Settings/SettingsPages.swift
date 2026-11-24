import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Settings and Customization pages, ported from the web (apps/web/src/app/(app)/settings and
// /customization). Same endpoints, same words.

// MARK: General

struct GeneralSettingsPage: View {
    @Environment(SessionStore.self) private var session
    @State private var confirmSignOut = false

    var body: some View {
        SettingsScroll {
            SettingsGroup(title: "Account") {
                SettingsRow(label: session.userName ?? "Signed in", sub: session.email, icon: AnyView(Avatar(name: session.userName ?? "", size: 32)))
                Button { confirmSignOut = true } label: {
                    SettingsRow(label: "Sign out", systemImage: "rectangle.portrait.and.arrow.right", labelColor: .danger)
                }
                .buttonStyle(RowButtonStyle())
            }

            SettingsGroup(title: "Appearance") {
                CardSection {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Theme").font(.system(size: 16))
                        Picker("Theme", selection: Binding(get: { session.theme }, set: { v in withAnimation(Motion.morph) { session.setTheme(v) } })) {
                            ForEach(ThemePreference.allCases) { t in Text(t.label).tag(t) }
                        }
                        .pickerStyle(.segmented)
                    }
                }
                CardSection {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Accent").font(.system(size: 16))
                            Spacer()
                            Text(session.accent.label).font(.system(size: 14)).foregroundStyle(.secondary)
                                .contentTransition(.opacity)
                        }
                        HStack(spacing: 4) {
                            ForEach(AccentID.allCases) { a in
                                Button {
                                    withAnimation(Motion.morph) { session.setAccent(a) }
                                } label: {
                                    AccentSwatch(accent: a, selected: session.accent == a, size: 30)
                                }
                                .buttonStyle(PressableStyle(scale: 0.9))
                            }
                        }
                        .sensoryFeedback(.selection, trigger: session.accent)
                    }
                }
            }

            SettingsGroup(title: "Advanced") {
                SettingsRow(label: "Nerd mode", info: "Shows reasoning, raw tool calls and token counts.") {
                    Toggle("Nerd mode", isOn: Binding(get: { session.nerdMode }, set: { v in withAnimation(Motion.morph) { session.setNerdMode(v) } }))
                        .labelsHidden()
                }
                if session.nerdMode && !session.models.isEmpty {
                    SettingsRow(label: "Default model") {
                        Picker("Default model", selection: Binding(get: { session.chosenModelId ?? "default" }, set: { session.setDefaultModel($0 == "default" ? nil : $0) })) {
                            Text("Server default").tag("default")
                            ForEach(session.models) { m in
                                Text(m.tier == true ? m.label : "\(m.label) (\(m.providerLabel))").tag(m.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .tint(.secondary)
                    }
                    .transition(.opacity)
                }
            }

            if let status = session.status {
                let model = session.models.first { $0.id == session.serverDefaultModelId }
                SettingsGroup(title: "Status") {
                    SettingsRow(label: "AI") {
                        StatusPill(ok: status.ai, text: status.ai ? (model?.label ?? session.serverDefaultModelId ?? "Ready") : "Off")
                    }
                    SettingsRow(label: "Web search", info: status.search ? nil : "Start the search service: docker compose up -d search") {
                        StatusPill(ok: status.search, text: status.search ? "Ready" : "Limited")
                    }
                    SettingsRow(label: "Connectors", info: status.connectors ? nil : "Add COMPOSIO_API_KEY to .env.local.") {
                        StatusPill(ok: status.connectors, text: status.connectors ? "Ready" : "Off")
                    }
                    SettingsRow(label: "Agent computers", info: status.sandbox ? nil : "Start Docker to give agents their computers.") {
                        StatusPill(ok: status.sandbox, text: status.sandbox ? "Ready" : "Off")
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(Motion.morph, value: session.status)
        .confirmationDialog("Sign out of Opal?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { session.signOut() }
        }
        .task { await session.loadUser() }
    }
}

// MARK: Study

struct StudySettingsPage: View {
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell

    private struct Source: Decodable { let kind: String; let label: String; let config: JSONValue? }
    private struct Book: Decodable, Identifiable { let id: String; let title: String; let subtitle: String? }
    struct ArtifactRow: Decodable, Identifiable { let id: String; let kind: String; let title: String; let createdAt: Date }

    static let grades: [(id: String, label: String)] = [
        ("K01", "Α΄ Δημοτικού"), ("K02", "Β΄ Δημοτικού"), ("K03", "Γ΄ Δημοτικού"), ("K04", "Δ΄ Δημοτικού"),
        ("K05", "Ε΄ Δημοτικού"), ("K06", "ΣΤ΄ Δημοτικού"), ("K07", "Α΄ Γυμνασίου"), ("K08", "Β΄ Γυμνασίου"),
        ("K09", "Γ΄ Γυμνασίου"), ("K10", "Α΄ Λυκείου"), ("K11", "Β΄ Λυκείου"), ("K12", "Γ΄ Λυκείου"),
    ]

    @State private var eclass: Source?
    @State private var sourcesLoaded = false
    @State private var url = ""
    @State private var username = ""
    @State private var password = ""
    @State private var saving = false
    @State private var grade = "K10"
    @State private var books: [Book]?
    @State private var artifacts: [ArtifactRow]?
    @State private var open: ArtifactRow?
    @State private var toast: Toast?

    private var dirty: Bool { !url.isEmpty || !username.isEmpty || !password.isEmpty }

    var body: some View {
        SettingsScroll(info: "Study AI reads your textbooks and course material, then explains, quizzes and makes flashcards. Any chat or agent can call it.") {
            AccentButton(title: "Start studying", systemImage: "graduationcap") { shell.newChat(study: true) }

            SettingsGroup(title: "Open eClass", info: "Your university's eClass. If it only allows single sign-on, Study AI signs in with its own browser instead.") {
                StatusPill(ok: eclass != nil, text: eclass?.label ?? (sourcesLoaded ? "Not set up" : ""))
            } content: {
                CardSection {
                    VStack(spacing: 14) {
                        FormField(label: "Address", text: $url, placeholder: eclass?.config?["baseUrl"]?.string ?? "https://eclass.uoa.gr", keyboard: .URL)
                        FormField(label: "Username", text: $username, placeholder: eclass?.config?["username"]?.string ?? "", keyboard: .asciiCapable)
                        FormField(label: "Password", text: $password, placeholder: eclass != nil ? "Saved" : "", secure: true, info: "Kept encrypted in your secrets vault. The AI never sees it.")
                        if dirty || (sourcesLoaded && eclass == nil) {
                            HStack {
                                Spacer()
                                AccentButton(title: "Save", disabled: eclass == nil ? (url.isEmpty || username.isEmpty) : !dirty, pending: saving) {
                                    Task { await saveEclass() }
                                }
                            }
                            .transition(.opacity)
                        }
                    }
                    .animation(Motion.morph, value: dirty)
                }
            }

            SettingsGroup(title: "Textbooks", info: "School books from ebooks.edu.gr.") {
                Picker("Grade", selection: $grade) {
                    ForEach(Self.grades, id: \.id) { g in Text(g.label).tag(g.id) }
                }
                .pickerStyle(.menu)
                .tint(.secondary)
            } content: {
                if let books {
                    if books.isEmpty {
                        EmptyRow("No books for this grade right now")
                    } else {
                        ForEach(books.prefix(80)) { b in
                            SettingsRow(label: b.title, sub: b.subtitle) {
                                Button {
                                    shell.newChat(study: true, prompt: "Βοήθησέ με να μελετήσω το βιβλίο «\(b.title)». Ref: \(b.id)")
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("Study")
                                        Image(systemName: "arrow.right").font(.system(size: 12, weight: .semibold))
                                    }
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(.horizontal, 12)
                                    .frame(height: 32)
                                    .background(Color.wash, in: Capsule())
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                } else {
                    SkeletonRows(count: 3)
                }
            }
            .animation(Motion.morph, value: books?.count)

            SettingsGroup(title: "Practice", info: "Quizzes and flashcards you make in chats.") {
                if let artifacts {
                    if artifacts.isEmpty {
                        EmptyRow("Nothing yet")
                    } else {
                        ForEach(artifacts) { a in
                            Button { open = a } label: {
                                SettingsRow(label: a.title, systemImage: a.kind == "quiz" ? "checklist" : "rectangle.on.rectangle") {
                                    Text(a.createdAt.formatted(date: .abbreviated, time: .omitted))
                                        .font(.system(size: 13).monospacedDigit())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .buttonStyle(RowButtonStyle())
                        }
                    }
                } else {
                    SkeletonRows()
                }
            }
        }
        .toast($toast)
        .task { await loadSources() }
        .task {
            struct Res: Decodable { let artifacts: [ArtifactRow] }
            let list = (try? await session.api.send("/api/artifacts?kinds=quiz,flashcards", as: Res.self).artifacts) ?? []
            withAnimation(Motion.morph) { artifacts = list }
        }
        .task(id: grade) {
            struct Res: Decodable { let items: [Book] }
            books = nil
            let items = (try? await session.api.send("/api/study/browse?source=ebooks&ref=grade:\(grade)", as: Res.self).items) ?? []
            var seen = Set<String>()
            withAnimation(Motion.morph) { books = items.filter { seen.insert($0.title).inserted } }
        }
        .sheet(item: $open) { a in
            ArtifactSheet(row: a)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private func loadSources() async {
        struct Res: Decodable { let sources: [Source] }
        let list = (try? await session.api.send("/api/study/sources", as: Res.self).sources) ?? []
        withAnimation(Motion.morph) {
            eclass = list.first { $0.kind == "eclass" }
            sourcesLoaded = true
        }
    }

    private func saveEclass() async {
        saving = true
        defer { saving = false }
        struct Body: Encodable { let kind = "eclass"; let baseUrl: String; let username: String }
        struct Secret: Encodable { let name = "ECLASS_PASSWORD"; let label = "eClass password"; let description = "Used by the Study AI to read your eClass"; let value: String }
        do {
            let base = url.isEmpty ? (eclass?.config?["baseUrl"]?.string ?? "") : url
            let user = username.isEmpty ? (eclass?.config?["username"]?.string ?? "") : username
            _ = try await session.api.sendRaw("/api/study/sources", method: "PUT", json: Body(baseUrl: base, username: user))
            if !password.isEmpty {
                _ = try await session.api.sendRaw("/api/secrets", json: Secret(value: password))
            }
            url = ""
            username = ""
            password = ""
            dismissKeyboard()
            await loadSources()
            toast = Toast(text: "eClass saved")
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }
}

/// A saved quiz or flashcard set, opened from Study.
struct ArtifactSheet: View {
    let row: StudySettingsPage.ArtifactRow
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var data: JSONValue?

    var body: some View {
        NavigationStack {
            ScrollView {
                Group {
                    if let data {
                        let call = ToolCall(
                            id: row.id,
                            name: row.kind == "quiz" ? "create_quiz" : "create_flashcards",
                            state: "output-available",
                            input: .object([
                                "title": .string(row.title),
                                "questions": data["questions"] ?? .array([]),
                                "cards": data["cards"] ?? .array([]),
                            ]),
                            output: nil, error: nil, approvalId: nil
                        )
                        if row.kind == "quiz" { QuizView(call: call) } else { FlashcardsView(call: call) }
                    } else {
                        SkeletonBlock(height: 280)
                    }
                }
                .padding(16)
            }
            .navigationTitle(row.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .task {
            let d = try? await session.api.send("/api/artifacts/\(row.id)", as: ArtifactResponse.self).artifact.data
            withAnimation(.easeOut(duration: 0.2)) { data = d ?? .object([:]) }
        }
    }
}

private struct ArtifactResponse: Decodable {
    struct Artifact: Decodable { let data: JSONValue? }
    let artifact: Artifact
}

// MARK: Handwriting

struct HandwritingSettingsPage: View {
    @Environment(SessionStore.self) private var session

    struct Profile: Decodable, Identifiable, Hashable { let id: String; let name: String; let glyphCount: Int }

    static let sample = """
        # Φωτοσύνθεση

        Η **φωτοσύνθεση** μετατρέπει το φως σε χημική ενέργεια.

        - Γίνεται στους χλωροπλάστες
        - Χρειάζεται νερό, CO2 και φως

        | Είσοδος | Έξοδος |
        | --- | --- |
        | CO2 + H2O | Γλυκόζη + O2 |

        ```chart
        {"type":"bar","title":"Ρυθμός ανά ώρα","labels":["9:00","12:00","15:00","18:00"],"values":[4,9,7,2]}
        ```
        """

    @State private var profiles: [Profile]?
    @State private var selected: String?
    @State private var newName = ""
    @State private var deleting: Profile?
    @State private var uploading: Int?
    @State private var pickingPage: Int?
    @State private var photo: PhotosPickerItem?
    @State private var filePage: Int?
    @State private var text = sample
    @State private var rendered = sample
    @State private var paper: HandwritingPaper = .lined
    @State private var ink: HandwritingInk = .blue
    @State private var toast: Toast?

    private var active: Profile? { profiles?.first { $0.id == selected } ?? profiles?.first }

    var body: some View {
        SettingsScroll(info: "Teach Opal your handwriting once. Any chat or agent can then write notes, tables and charts in it.") {
            SettingsGroup(title: "Profiles") {
                if let profiles {
                    ForEach(profiles) { p in
                        Button { withAnimation(Motion.quick) { selected = p.id } } label: {
                            SettingsRow(label: p.name, sub: "\(p.glyphCount) letters", icon: AnyView(
                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).opacity(active?.id == p.id ? 1 : 0)
                            )) {
                                Button { deleting = p } label: {
                                    Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(.secondary).frame(width: 36, height: 36)
                                }
                                .buttonStyle(PressableStyle(scale: 0.9))
                                .accessibilityLabel("Delete \(p.name)")
                            }
                        }
                        .buttonStyle(RowButtonStyle())
                        .accessibilityAddTraits(active?.id == p.id ? .isSelected : [])
                    }
                } else {
                    SkeletonRows(count: 1)
                }
                CardSection(padding: 8) {
                    HStack(spacing: 8) {
                        TextField("New profile", text: $newName)
                            .font(.system(size: 16))
                            .submitLabel(.done)
                            .onSubmit { Task { await create() } }
                        Button { Task { await create() } } label: {
                            Image(systemName: "plus").font(.system(size: 15, weight: .semibold))
                                .frame(width: 36, height: 36)
                                .background(Color.wash, in: Circle())
                        }
                        .buttonStyle(PressableStyle(scale: 0.9))
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel("Add profile")
                    }
                }
            }
            .animation(Motion.morph, value: profiles)

            if let p = active {
                SettingsGroup(title: "Set up \(p.name)") {
                    CardSection {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("1. Print").font(.system(size: 16))
                            Text("\(HandwritingTemplate.pageCount) pages with every Greek and Latin letter, digit and symbol. Print at 100% on A4.")
                                .font(.system(size: 13)).foregroundStyle(.secondary)
                            FlowLayout(spacing: 8) {
                                ForEach(1...HandwritingTemplate.pageCount, id: \.self) { n in
                                    SmallButton(title: "\(n)", systemImage: "printer") { share(page: n, name: p.name) }
                                        .accessibilityLabel("Print page \(n)")
                                }
                            }
                        }
                    }
                    CardSection {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("2. Upload").font(.system(size: 16))
                            Text("Dark pen, one character per box on the dotted line. Photograph from above in good light with all four corner squares in frame.")
                                .font(.system(size: 13)).foregroundStyle(.secondary)
                            FlowLayout(spacing: 8) {
                                ForEach(1...HandwritingTemplate.pageCount, id: \.self) { n in
                                    Menu {
                                        Button { pickingPage = n } label: { Label("Photo library", systemImage: "photo.on.rectangle") }
                                        Button { filePage = n } label: { Label("Files", systemImage: "folder") }
                                    } label: {
                                        HStack(spacing: 6) {
                                            if uploading == n { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.up").font(.system(size: 13, weight: .medium)) }
                                            Text("\(n)").font(.system(size: 14, weight: .medium))
                                        }
                                        .foregroundStyle(.primary)
                                        .padding(.horizontal, 14)
                                        .frame(height: 34)
                                        .background(Color.wash, in: Capsule())
                                    }
                                    .disabled(uploading != nil)
                                    .accessibilityLabel("Upload page \(n)")
                                }
                            }
                        }
                    }
                }
                .transition(.opacity)
            }

            SettingsGroup(title: "Try it", info: "\(active.map { $0.glyphCount > 20 } == true ? "Uses your handwriting." : "No finished profile yet, so a stand-in hand is used.") Markdown, tables and chart blocks work.", bare: true) {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Text to write", text: $text, axis: .vertical)
                        .font(.system(size: 13, design: .monospaced))
                        .lineLimit(6...14)
                        .padding(14)
                        .background(Color.card, in: .rect(cornerRadius: 16, style: .continuous))
                    Picker("Paper", selection: $paper) {
                        ForEach(HandwritingPaper.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Picker("Ink", selection: $ink) {
                        ForEach(HandwritingInk.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        Spacer()
                        AccentButton(title: "Write it", systemImage: "pencil.and.scribble") {
                            dismissKeyboard()
                            rendered = text
                        }
                    }
                    HandwritingView(
                        markdown: rendered,
                        profileId: active.flatMap { $0.glyphCount > 20 ? $0.id : nil },
                        paper: paper,
                        ink: ink,
                        title: "Opal handwriting"
                    )
                }
            }
        }
        .toast($toast)
        .task { await load() }
        .photosPicker(isPresented: Binding(get: { pickingPage != nil }, set: { if !$0 && photo == nil { pickingPage = nil } }), selection: $photo, matching: .images)
        .onChange(of: photo) { _, item in
            guard let item, let page = pickingPage, let p = active else { return }
            photo = nil
            pickingPage = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                await upload(data, page: page, profile: p)
            }
        }
        .fileImporter(isPresented: Binding(get: { filePage != nil }, set: { if !$0 { filePage = nil } }), allowedContentTypes: [.jpeg, .png, .heic, .webP]) { result in
            guard case .success(let url) = result, let page = filePage, let p = active else { return }
            filePage = nil
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            Task { await upload(data, page: page, profile: p) }
        }
        .confirmationDialog(deleting.map { "Delete \($0.name)?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { p in
            Button("Delete", role: .destructive) { Task { await delete(p) } }
        } message: { _ in
            Text("Its letters are deleted too.")
        }
    }

    private func load() async {
        struct Res: Decodable { let profiles: [Profile] }
        if let list = try? await session.api.send("/api/handwriting/profiles", as: Res.self).profiles {
            withAnimation(Motion.morph) { profiles = list }
        } else if profiles == nil {
            profiles = []
        }
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        struct Res: Decodable { let profile: Profile }
        do {
            let p = try await session.api.send("/api/handwriting/profiles", method: "POST", json: ["name": name], as: Res.self).profile
            newName = ""
            await load()
            selected = p.id
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }

    private func delete(_ p: Profile) async {
        _ = try? await session.api.sendRaw("/api/handwriting/profiles/\(p.id)", method: "DELETE")
        if selected == p.id { selected = nil }
        await load()
    }

    /// The template page as a PDF, through the share sheet (Print is in there).
    private func share(page: Int, name: String) {
        let data = HandwritingTemplate.pdf(page: page, name: name)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Opal handwriting \(page).pdf")
        do {
            try data.write(to: url, options: .atomic)
            presentActivity([url])
        } catch {
            toast = Toast(text: "Couldn't make the page", error: true)
        }
    }

    /// Photos are often far bigger than the sheet needs: send a 4000px JPEG.
    private func upload(_ raw: Data, page: Int, profile: Profile) async {
        struct Res: Decodable { let found: Int; let missing: [String]; let markers: String }
        uploading = page
        defer { uploading = nil }
        var data = raw
        if let image = UIImage(data: raw) {
            data = image.scaledDown(maxSide: 4000).jpegData(compressionQuality: 0.92) ?? raw
        }
        do {
            let r = try await session.api.upload("/api/handwriting/profiles/\(profile.id)/pages/\(page)", field: "image", data: data, filename: "page-\(page).jpg", mediaType: "image/jpeg", as: Res.self)
            let missing = r.missing.isEmpty ? "" : "Missing \(r.missing.prefix(10).joined(separator: " "))\(r.missing.count > 10 ? "…" : "")"
            let edges = r.markers == "edges" ? "Corner squares not found; used the photo's edges." : ""
            let detail = [missing, edges].filter { !$0.isEmpty }.joined(separator: " ")
            toast = Toast(text: "Page \(page): \(r.found) letters", detail: detail.isEmpty ? nil : detail)
            await load()
        } catch {
            toast = Toast(text: "Page \(page)", detail: error.localizedDescription, error: true)
        }
    }
}

// MARK: Secrets

struct SecretsSettingsPage: View {
    @Environment(SessionStore.self) private var session
    private struct Secret: Decodable, Identifiable, Hashable {
        let name: String
        let label: String?
        let lastUsedAt: Date?
        var id: String { name }
        var title: String { label?.isEmpty == false ? label! : name }
    }
    @State private var secrets: [Secret]?
    @State private var deleting: Secret?

    var body: some View {
        SettingsScroll(info: "Passwords and keys your agents asked for. Encrypted; never shown to you or the AI.") {
            SettingsGroup {
                if let secrets {
                    if secrets.isEmpty { EmptyRow("No secrets yet") }
                    ForEach(secrets) { s in
                        SettingsRow(label: s.title, sub: s.name + (s.lastUsedAt.map { " · used \($0.formatted(date: .abbreviated, time: .omitted))" } ?? ""), systemImage: "key", mono: true) {
                            Button { deleting = s } label: {
                                Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(.secondary).frame(width: 36, height: 36)
                            }
                            .buttonStyle(PressableStyle(scale: 0.9))
                            .accessibilityLabel("Delete \(s.title)")
                        }
                        .transition(.opacity)
                    }
                } else {
                    SkeletonRows()
                }
            }
            .animation(Motion.morph, value: secrets)
        }
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(deleting.map { "Delete \($0.title)?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { s in
            Button("Delete", role: .destructive) {
                Task {
                    let name = s.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s.name
                    _ = try? await session.api.sendRaw("/api/secrets?name=\(name)", method: "DELETE")
                    await load()
                }
            }
        } message: { _ in
            Text("Agents that use it will ask for it again.")
        }
    }

    private func load() async {
        struct Res: Decodable { let secrets: [Secret] }
        let list = (try? await session.api.send("/api/secrets", as: Res.self).secrets) ?? secrets ?? []
        withAnimation(Motion.morph) { secrets = list }
    }
}

// MARK: Memory

struct MemorySettingsPage: View {
    @Environment(SessionStore.self) private var session
    struct Memory: Decodable, Identifiable, Hashable { let id: String; var content: String; let source: String? }
    @State private var memories: [Memory]?
    @State private var draft = ""
    @State private var query = ""
    @State private var clearing = false
    @State private var toast: Toast?

    var body: some View {
        let list = memories ?? []
        let shown = query.isEmpty ? list : list.filter { $0.content.localizedCaseInsensitiveContains(query) }
        SettingsScroll(info: "What Opal remembers about you across chats. It adds to this as you talk, and you can change anything here.") {
            SettingsGroup {
                SettingsRow(label: "Use memory") {
                    Toggle("Use memory", isOn: Binding(get: { session.memoryEnabled }, set: { v in withAnimation(Motion.morph) { session.setMemoryEnabled(v) } }))
                        .labelsHidden()
                }
                CardSection(padding: 8) {
                    HStack(spacing: 8) {
                        TextField("Add something to remember", text: $draft)
                            .font(.system(size: 16))
                            .submitLabel(.done)
                            .onSubmit { Task { await add() } }
                            .onChange(of: draft) { _, v in if v.count > 500 { draft = String(v.prefix(500)) } }
                        Button { Task { await add() } } label: {
                            Image(systemName: "plus").font(.system(size: 15, weight: .semibold))
                                .frame(width: 36, height: 36)
                                .background(Color.wash, in: Circle())
                        }
                        .buttonStyle(PressableStyle(scale: 0.9))
                        .disabled(draft.trimmingCharacters(in: .whitespaces).count < 2)
                        .accessibilityLabel("Add memory")
                    }
                }
            }

            SettingsGroup(title: list.isEmpty ? "Saved" : "Saved · \(list.count)") {
                if !list.isEmpty {
                    Button("Clear all") { clearing = true }
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
            } content: {
                if list.count > 8 {
                    CardSection(padding: 8) {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("Search", text: $query).font(.system(size: 16))
                        }
                    }
                }
                if memories == nil {
                    SkeletonRows()
                } else if list.isEmpty {
                    EmptyRow("Nothing yet")
                } else if shown.isEmpty {
                    EmptyRow("No matches")
                }
                ForEach(shown) { m in
                    MemoryItem(memory: m) { await load() } onError: { toast = Toast(text: $0, error: true) }
                        .transition(.opacity)
                }
            }
            .opacity(session.memoryEnabled ? 1 : 0.6)
            .animation(Motion.morph, value: shown)
        }
        .toast($toast)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog("Forget everything?", isPresented: $clearing, titleVisibility: .visible) {
            Button("Forget all", role: .destructive) {
                Task {
                    _ = try? await session.api.sendRaw("/api/memory", method: "DELETE")
                    await load()
                }
            }
        } message: {
            Text("All saved memories are deleted. This can't be undone.")
        }
    }

    private func load() async {
        struct Res: Decodable { let memories: [Memory] }
        let list = (try? await session.api.send("/api/memory", as: Res.self).memories) ?? memories ?? []
        withAnimation(Motion.morph) { memories = list }
    }

    private func add() async {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard content.count >= 2 else { return }
        do {
            _ = try await session.api.sendRaw("/api/memory", json: ["content": content])
            draft = ""
            await load()
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }
}

/// One memory: tap the text to edit it in place.
private struct MemoryItem: View {
    let memory: MemorySettingsPage.Memory
    let onChanged: () async -> Void
    let onError: (String) -> Void
    @Environment(SessionStore.self) private var session
    @State private var editing = false
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if memory.source == "opal" {
                    OpalMark(size: 14).foregroundStyle(.secondary)
                } else {
                    Image(systemName: "person").font(.system(size: 14)).foregroundStyle(.secondary)
                }
            }
            .frame(width: 20, height: 22)
            .accessibilityLabel(memory.source == "opal" ? "Saved by Opal" : "Added by you")
            if editing {
                TextField("Memory", text: $value, axis: .vertical)
                    .font(.system(size: 15))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await save() } }
                    .onChange(of: focused) { _, f in if !f && editing { Task { await save() } } }
            } else {
                Text(memory.content)
                    .font(.system(size: 15))
                    .lineSpacing(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                    .onTapGesture {
                        value = memory.content
                        editing = true
                        focused = true
                    }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint("Edit")
            }
            Button {
                Task {
                    _ = try? await session.api.sendRaw("/api/memory/\(memory.id)", method: "DELETE")
                    await onChanged()
                }
            } label: {
                Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(.secondary).frame(width: 30, height: 24)
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .accessibilityLabel("Forget")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .top) { RowDivider() }
    }

    private func save() async {
        editing = false
        let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty, next != memory.content else { return }
        do {
            _ = try await session.api.sendRaw("/api/memory/\(memory.id)", method: "PATCH", json: ["content": next])
            await onChanged()
        } catch {
            onError(error.localizedDescription)
        }
    }
}

// MARK: Skills (chat and code)

struct SkillsSettingsPage: View {
    enum Kind { case chat, code }
    let kind: Kind
    @Environment(SessionStore.self) private var session

    struct Skill: Decodable, Identifiable, Hashable {
        var id: String?
        var name: String
        var description: String
        var instructions: String
        var enabled: Bool
        var key: String { id ?? "example-\(name)" }

        init(id: String? = nil, name: String, description: String, instructions: String, enabled: Bool) {
            self.id = id
            self.name = name
            self.description = description
            self.instructions = instructions
            self.enabled = enabled
        }

        // Older rows have no `enabled` or an empty description: still show them.
        init(from decoder: any Decoder) throws {
            enum K: String, CodingKey { case id, name, description, instructions, enabled }
            let c = try decoder.container(keyedBy: K.self)
            id = try c.decodeIfPresent(String.self, forKey: .id)
            name = try c.decode(String.self, forKey: .name)
            description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
            instructions = (try? c.decodeIfPresent(String.self, forKey: .instructions)) ?? ""
            enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true
        }
    }

    struct Draft: Identifiable { let skill: Skill?; let example: Skill?; var id: String { skill?.key ?? example?.key ?? "new" } }

    @State private var skills: [Skill]?
    @State private var editing: Draft?
    @State private var toast: Toast?

    private var base: String { kind == .chat ? "/api/skills" : "/api/code/skills" }

    private var examples: [Skill] {
        switch kind {
        case .chat:
            [
                Skill(name: "Exam prep", description: "When I'm preparing for a test or exam", instructions: """
                    1. If I didn't say, ask for the subject, the chapters and the exam date.
                    2. Find the material with the study tools and read it.
                    3. Write a one-page summary of the key points.
                    4. Make a 10-question quiz with an explanation for every option, then flashcards for definitions.
                    5. End with a short revision plan up to the exam date.
                    """, enabled: true),
                Skill(name: "Email in my voice", description: "When writing or replying to an email", instructions: """
                    Write like me: short, warm, no corporate phrases.
                    Reply in the language the other person used.
                    Start with the point and end with one clear next step.
                    Sign with my first name only.
                    Show me the draft. Never send without asking.
                    """, enabled: true),
                Skill(name: "Research brief", description: "When I ask to research or compare something", instructions: """
                    Search the web for at least four good sources and read them.
                    Then write:
                    - a three-sentence summary
                    - a comparison table when there are options
                    - pros and cons, and a recommendation
                    List the sources with links at the end.
                    """, enabled: true),
            ]
        case .code:
            [
                Skill(name: "Review", description: "Review the current changes before I commit", instructions: """
                    Review the uncommitted changes (git diff) as a strict senior reviewer.
                    1. List real bugs first, each with file:line and a one-line fix.
                    2. Then risky patterns (security, races, missing error handling).
                    3. Skip style nits unless they hide a bug.
                    Do not edit files; report only.
                    """, enabled: true),
                Skill(name: "Tests", description: "Write tests for what I just changed", instructions: """
                    Find the code changed in this branch and write focused tests for it using the project's existing test setup.
                    Cover the main path and the edge cases that could break.
                    Run the tests and fix any test that fails because of the test itself. Report anything that fails because of the code.
                    """, enabled: true),
                Skill(name: "Ship", description: "Typecheck, test, then commit with a clear message", instructions: """
                    1. Run the project's typecheck and tests; fix what fails.
                    2. Commit with a short imperative subject line and a short body explaining why.
                    3. Don't push unless I ask.
                    """, enabled: true),
            ]
        }
    }

    var body: some View {
        let list = skills ?? []
        let unused = examples.filter { e in !list.contains { $0.name.lowercased() == e.name.lowercased() } }
        SettingsScroll(info: kind == .chat
            ? "Instructions Opal follows when a task fits. Type / in a chat to use one directly."
            : "Instructions for coding agents. Type / in the Code composer to use one. These are separate from Opal chat's skills.") {
            AccentButton(title: "New skill", systemImage: "plus") { editing = Draft(skill: nil, example: nil) }

            if skills == nil {
                SettingsGroup { SkeletonRows() }
            } else if !list.isEmpty {
                SettingsGroup {
                    ForEach(list, id: \.key) { s in
                        // Tap the row to edit; the switch turns the skill on or off.
                        SettingsRow(label: kind == .code ? "/\(s.name)" : s.name, sub: s.description, systemImage: "wand.and.stars") {
                            Toggle("Use \(s.name)", isOn: Binding(get: { s.enabled }, set: { v in Task { await toggle(s, v) } }))
                                .labelsHidden()
                        }
                        .onTapGesture { editing = Draft(skill: s, example: nil) }
                        .accessibilityAction(named: "Edit") { editing = Draft(skill: s, example: nil) }
                    }
                }
            }

            if skills != nil && !unused.isEmpty {
                SettingsGroup(title: list.isEmpty ? "Start from an example" : "Examples") {
                    ForEach(unused, id: \.key) { e in
                        SettingsRow(label: e.name, sub: e.description, systemImage: "wand.and.stars") {
                            Button("Use") { editing = Draft(skill: nil, example: e) }
                                .font(.system(size: 14, weight: .medium))
                                .buttonStyle(.bordered)
                                .buttonBorderShape(.capsule)
                                .tint(.primary)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(Motion.morph, value: skills)
        .toast($toast)
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $editing) { d in
            SkillEditorSheet(kind: kind, base: base, skill: d.skill, example: d.example) { message in
                toast = Toast(text: message)
                Task { await load() }
            }
        }
    }

    private func load() async {
        struct Res: Decodable { let skills: [Skill] }
        let list = (try? await session.api.send(base, as: Res.self).skills) ?? skills ?? []
        withAnimation(Motion.morph) { skills = list }
    }

    private func toggle(_ s: Skill, _ enabled: Bool) async {
        guard let id = s.id else { return }
        if let i = skills?.firstIndex(where: { $0.id == id }) { skills?[i].enabled = enabled }
        do {
            _ = try await session.api.sendRaw("\(base)/\(id)", method: "PATCH", json: ["enabled": enabled])
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
            await load()
        }
    }
}

private struct SkillEditorSheet: View {
    let kind: SkillsSettingsPage.Kind
    let base: String
    let skill: SkillsSettingsPage.Skill?
    let example: SkillsSettingsPage.Skill?
    let onSaved: (String) -> Void
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var pending = false
    @State private var error: String?
    @State private var confirmDelete = false

    private var valid: Bool {
        name.trimmingCharacters(in: .whitespaces).count >= 2 && instructions.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    FormField(label: "Name", text: $name, placeholder: kind == .chat ? "Exam prep" : "Review", limit: 40)
                    FormField(
                        label: "When to use",
                        text: $description,
                        placeholder: kind == .chat ? "When I'm preparing for an exam" : "Review the current changes",
                        limit: 240,
                        info: kind == .chat ? "Opal reads this to decide when to load the skill." : "Shown next to the skill in the / menu."
                    )
                    FormEditor(label: "Instructions", text: $instructions, placeholder: "Steps, tone, format…", minHeight: 240)
                    if let error { ErrorNote(text: error) }
                    if skill?.id != nil {
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label("Delete", systemImage: "trash")
                                .font(.system(size: 16))
                                .foregroundStyle(Color.danger)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .background(Color.danger.opacity(0.1), in: Capsule())
                        }
                        .buttonStyle(PressableStyle(scale: 0.97))
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(skill?.id != nil ? "Edit skill" : "New skill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if pending { ProgressView() } else {
                        Button("Save") { Task { await save() } }.fontWeight(.semibold).disabled(!valid)
                    }
                }
            }
            .confirmationDialog(kind == .code ? "Delete /\(name)?" : "Delete \(name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
        }
        .onAppear {
            let s = skill ?? example
            name = s?.name ?? ""
            description = s?.description ?? ""
            instructions = s?.instructions ?? ""
        }
    }

    private func save() async {
        guard valid else { return }
        pending = true
        error = nil
        defer { pending = false }
        struct Body: Encodable { let name: String; let description: String; let instructions: String }
        let body = Body(
            name: name.trimmingCharacters(in: .whitespaces),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        do {
            if let id = skill?.id {
                _ = try await session.api.sendRaw("\(base)/\(id)", method: "PATCH", json: body)
                onSaved("Saved")
            } else {
                _ = try await session.api.sendRaw(base, json: body)
                onSaved("\(body.name) added")
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete() async {
        guard let id = skill?.id else { return }
        _ = try? await session.api.sendRaw("\(base)/\(id)", method: "DELETE")
        onSaved("Deleted")
        dismiss()
    }
}

// MARK: Connectors

struct ConnectorsSettingsPage: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    private struct Toolkit: Decodable, Identifiable, Hashable {
        let slug: String
        let name: String
        let logo: String?
        let connected: Bool
        let connectedAccountId: String?
        let noAuth: Bool?
        var id: String { slug }
    }

    @State private var enabled: Bool?
    @State private var toolkits: [Toolkit] = []
    @State private var loaded = false
    @State private var query = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var toast: Toast?

    var body: some View {
        let connected = toolkits.filter(\.connected)
        let others = toolkits.filter { !$0.connected }
        Group {
            if enabled == false {
                SettingsScroll {
                    SettingsGroup {
                        SettingsRow(label: "Not set up", info: "Add COMPOSIO_API_KEY to apps/web/.env.local and restart the server.")
                    }
                }
            } else {
                SettingsScroll(info: "Apps Opal and your agents can use. They ask before changing anything. Sign-in goes through Composio; Opal never sees your passwords.") {
                    if let error { ErrorNote(text: error) }
                    if !connected.isEmpty {
                        SettingsGroup(title: "Connected") {
                            ForEach(connected) { t in
                                SettingsRow(label: t.name, icon: AnyView(logo(t))) {
                                    Button { Task { await disconnect(t) } } label: {
                                        if busy == t.slug { ProgressView() } else { Text("Disconnect") }
                                    }
                                    .font(.system(size: 14))
                                    .foregroundStyle(.secondary)
                                    .disabled(busy != nil)
                                }
                            }
                        }
                    }
                    SettingsGroup(title: connected.isEmpty ? "Apps" : "More apps") {
                        if !loaded {
                            SkeletonRows(count: 4)
                        } else if others.isEmpty {
                            EmptyRow(query.isEmpty ? "Every app is connected" : "No apps match")
                        }
                        ForEach(others) { t in
                            SettingsRow(label: t.name, icon: AnyView(logo(t))) {
                                if t.noAuth == true {
                                    Text("Ready").font(.system(size: 13)).foregroundStyle(.tertiary)
                                } else {
                                    Button { Task { await connect(t) } } label: {
                                        Group {
                                            if busy == t.slug { ProgressView().controlSize(.small) } else { Text("Connect") }
                                        }
                                        .font(.system(size: 14, weight: .medium))
                                        .padding(.horizontal, 12)
                                        .frame(height: 32)
                                        .background(Color.wash, in: Capsule())
                                    }
                                    .buttonStyle(PressableStyle())
                                    .disabled(busy != nil)
                                }
                            }
                        }
                    }
                }
            }
        }
        .animation(Motion.morph, value: toolkits)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search apps")
        .toast($toast)
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled else { return }
            await load()
        }
        // Coming back from the sign-in page in Safari.
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private func logo(_ t: Toolkit) -> some View {
        Group {
            if let logo = t.logo, let url = URL(string: logo) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    RoundedRectangle(cornerRadius: 7).fill(Color.wash)
                }
            } else {
                Text(String(t.name.prefix(1))).font(.system(size: 13, weight: .medium))
                    .frame(width: 28, height: 28)
                    .background(Color.wash, in: .rect(cornerRadius: 7, style: .continuous))
            }
        }
        .frame(width: 28, height: 28)
        .clipShape(.rect(cornerRadius: 7, style: .continuous))
    }

    private func load() async {
        struct Res: Decodable { let enabled: Bool; let toolkits: [Toolkit] }
        let q = query.trimmingCharacters(in: .whitespaces)
        let path = q.isEmpty ? "/api/connectors" : "/api/connectors?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)"
        do {
            let r = try await session.api.send(path, as: Res.self)
            withAnimation(Motion.morph) {
                enabled = r.enabled
                toolkits = r.toolkits
                error = nil
            }
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func connect(_ t: Toolkit) async {
        struct Res: Decodable { let redirectUrl: String }
        busy = t.slug
        defer { busy = nil }
        do {
            let r = try await session.api.send("/api/connectors", method: "POST", json: ["toolkit": t.slug], as: Res.self)
            if let url = URL(string: r.redirectUrl) { openURL(url) }
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }

    private func disconnect(_ t: Toolkit) async {
        guard let account = t.connectedAccountId else { return }
        busy = t.slug
        defer { busy = nil }
        do {
            _ = try await session.api.sendRaw("/api/connectors?account=\(account.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? account)", method: "DELETE")
            await load()
            toast = Toast(text: "\(t.name) disconnected")
        } catch {
            toast = Toast(text: error.localizedDescription, error: true)
        }
    }
}
