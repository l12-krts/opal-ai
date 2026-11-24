import QuickLook
import SwiftUI

// Files in a chat that open in the app: ones an agent attached from its computer (share_file) and
// the ones you sent. Tap one and it downloads, then opens in Quick Look (PDFs, images, text, office
// files, audio, video), with Share for anything Quick Look can't show.

enum OpalFiles {
    /// The file on the phone, downloaded once into a temporary folder and named after itself, so
    /// Quick Look can tell what it is.
    static func local(_ path: String, name: String, api: APIClient) async throws -> URL {
        let id = path.split(separator: "/").last.map(String.init) ?? UUID().uuidString
        let safe = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("opal-files", isDirectory: true)
            .appendingPathComponent(id, isDirectory: true)
        let url = folder.appendingPathComponent(safe.isEmpty ? "file" : safe)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let data = try await api.data(path)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        return url
    }

    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    /// "PDF", "XLSX", "Image"…: what the file is, in a word.
    static func type(name: String, kind: String?) -> String {
        let ext = name.contains(".") ? (name.split(separator: ".").last.map { $0.uppercased() } ?? "") : ""
        if kind == "pdf" { return "PDF" }
        if !ext.isEmpty { return ext }
        switch kind {
        case "image": return "Image"
        case "text": return "Text"
        default: return "File"
        }
    }

    static func icon(name: String, mediaType: String, kind: String?) -> String {
        let ext = name.split(separator: ".").last.map { $0.lowercased() } ?? ""
        if kind == "image" || mediaType.hasPrefix("image/") { return "photo" }
        if kind == "pdf" || mediaType == "application/pdf" { return "doc.richtext" }
        if mediaType.hasPrefix("audio/") { return "waveform" }
        if mediaType.hasPrefix("video/") { return "film" }
        if ["xlsx", "xls", "csv", "numbers"].contains(ext) { return "tablecells" }
        if ["pptx", "ppt", "key"].contains(ext) { return "rectangle.on.rectangle" }
        if ["zip", "gz", "tar", "tgz", "7z"].contains(ext) { return "doc.zipper" }
        return "doc.text"
    }
}

/// A button that opens a file from Opal in Quick Look. The label is told while it downloads.
struct OpenableFile<Label: View>: View {
    let path: String
    let name: String
    @ViewBuilder var label: (_ loading: Bool) -> Label

    @Environment(SessionStore.self) private var session
    @State private var loading = false
    @State private var preview: URL?
    @State private var problem: String?

    var body: some View {
        Button {
            guard !loading else { return }
            loading = true
            Task {
                defer { loading = false }
                do {
                    preview = try await OpalFiles.local(path, name: name, api: session.api)
                } catch {
                    problem = Connectivity.describe(error)
                }
            }
        } label: {
            label(loading)
        }
        .buttonStyle(PressableStyle())
        .quickLookPreview($preview)
        .alert("Couldn't open \(name)", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
        .accessibilityHint("Opens the file")
    }
}

/// A file an agent attached from its computer: a card in the answer that opens the file.
struct SharedFileCard: View {
    let call: ToolCall
    let streaming: Bool

    var body: some View {
        let file = call.output?["file"]
        let name = file?["name"]?.string
            ?? call.input?["name"]?.string
            ?? call.input?["path"]?.string?.split(separator: "/").last.map(String.init)
            ?? "file"
        if let file, let url = file["url"]?.string {
            let kind = file["kind"]?.string
            let mediaType = file["mediaType"]?.string ?? ""
            OpenableFile(path: url, name: name) { loading in
                FileRow(
                    name: name,
                    detail: "\(OpalFiles.type(name: name, kind: kind)) · \(OpalFiles.size(file["size"]?.int ?? 0))",
                    icon: OpalFiles.icon(name: name, mediaType: mediaType, kind: kind),
                    thumbnail: kind == "image" ? url : nil,
                    busy: loading
                )
            }
        } else {
            let failed = call.failed || call.output?["ok"]?.bool == false
            let working = call.running && streaming
            FileRow(
                name: name,
                detail: failed ? (call.output?["error"]?.string ?? call.error ?? "Couldn't attach the file") : working ? "Attaching…" : "Not attached",
                icon: failed ? "exclamationmark.triangle" : "doc",
                thumbnail: nil,
                busy: working,
                failed: failed
            )
        }
    }
}

/// The card itself: an icon (or a thumbnail), the name, and what it is.
private struct FileRow: View {
    let name: String
    let detail: String
    let icon: String
    let thumbnail: String?
    var busy = false
    var failed = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                if let thumbnail {
                    AuthedImage(path: thumbnail)
                } else {
                    Color.wash
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(failed ? Color.danger : .secondary)
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(.rect(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(failed ? Color.danger : .secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if busy {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 12)
        .frame(height: 58)
        .frame(maxWidth: 340, alignment: .leading)
        .opalCard(radius: 14)
        .contentShape(.rect(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}
