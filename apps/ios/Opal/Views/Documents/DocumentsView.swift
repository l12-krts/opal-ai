import SwiftUI

/// Every document Opal and your agents made, newest change first (the web's /documents). Tap one
/// to open it; hold for its chat or to delete it.
struct DocumentsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Shell.self) private var shell
    @State private var rows: [Row]?
    @State private var filter: DocKind?
    @State private var open: DocSnapshot?
    @State private var deleting: Row?

    struct Row: Identifiable, Equatable {
        let id: String
        let snap: DocSnapshot
        let updatedAt: Date
        let conversationId: String?
    }

    private struct Item: Decodable {
        let id: String
        let kind: String
        let title: String
        let updatedAt: Date
        let conversationId: String?
        let data: JSONValue?
    }

    private var shown: [Row] { (rows ?? []).filter { filter == nil || $0.snap.kind == filter } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                filters
                if rows == nil {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(0..<4, id: \.self) { _ in SkeletonBlock(height: 172, radius: 16) }
                    }
                    .transition(.opacity)
                } else if shown.isEmpty {
                    empty
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(shown) { r in tile(r).transition(.opacity.combined(with: .scale(scale: 0.98))) }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 32)
            .animation(Motion.morph, value: shown)
        }
        .refreshable { await load() }
        .topBar {
            ScreenHeader {
                HeaderTitle(text: "Documents")
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $open) { s in
            DocumentViewer(snap: s)
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            deleting.map { "Delete “\($0.snap.displayTitle)”?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { r in
            Button("Delete", role: .destructive) { Task { await delete(r) } }
        } message: { _ in
            Text("It's deleted for good. Chats that showed it keep their copy.")
        }
    }

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: 156), spacing: 12, alignment: .top)] }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("All", selected: filter == nil) { filter = nil }
                ForEach(DocKind.allCases) { k in
                    chip(k.plural, selected: filter == k) { filter = k }
                }
            }
        }
        .scrollClipDisabled()
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.morph) { action() }
        } label: {
            Text(title)
                .font(.system(size: 14, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? .primary : .secondary)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(selected ? Color.wash : .clear, in: Capsule())
                .overlay { Capsule().strokeBorder(Color.primary.opacity(selected ? 0 : 0.1)) }
                .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func tile(_ r: Row) -> some View {
        Button { open = r.snap } label: {
            VStack(alignment: .leading, spacing: 0) {
                DocPreview(snap: r.snap, height: 112)
                Divider()
                HStack(spacing: 9) {
                    Image(systemName: r.snap.systemImage).font(.system(size: 14)).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.snap.displayTitle).font(.system(size: 14.5, weight: .medium)).lineLimit(1)
                        Text("\(r.snap.kind.label) · \(r.updatedAt.shortRelative)")
                            .font(.system(size: 12.5))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.primary)
                .padding(.horizontal, 11)
                .frame(height: 56)
            }
            .opalCard(radius: 16)
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityLabel("\(r.snap.displayTitle), \(r.snap.kind.label)")
        .accessibilityIdentifier("document-tile-\(r.snap.kind.rawValue)")
        .contextMenu {
            if let cid = r.conversationId {
                Button { shell.go(.chat(id: cid, isNew: false, agentId: nil)) } label: { Label("Open chat", systemImage: "bubble.left") }
            }
            Button(role: .destructive) { deleting = r } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.on.doc").font(.system(size: 34, weight: .light)).foregroundStyle(.tertiary)
            Text(filter.map { "No \($0.plural.lowercased()) yet" } ?? "No documents yet").font(.system(size: 19, weight: .semibold))
            Text("Ask Opal in any chat: “write a one-page plan”, “make slides about…”, “put this in a sheet”, “chart these numbers”, “brainstorm on a whiteboard”.")
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            AccentButton(title: "New chat", systemImage: "square.and.pencil") { shell.newChat() }
                .padding(.top, 6)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
        .transition(.opacity)
    }

    private func load() async {
        struct Res: Decodable { let artifacts: [Item] }
        let kinds = DocKind.allCases.map(\.rawValue).joined(separator: ",")
        do {
            let items = try await session.api.send("/api/artifacts?kinds=\(kinds)&data=1", as: Res.self).artifacts
            let list = items.compactMap { i -> Row? in
                guard let kind = DocKind(rawValue: i.kind) else { return nil }
                let snap = DocSnapshot(artifactId: i.id, kind: kind, title: i.title, version: i.data?["version"]?.int ?? 1, data: i.data)
                return Row(id: i.id, snap: snap, updatedAt: i.updatedAt, conversationId: i.conversationId)
            }
            withAnimation(Motion.morph) { rows = list }
        } catch let e as APIError where e.status == 401 {
            session.handleUnauthorized(e)
        } catch {
            if rows == nil { withAnimation(Motion.morph) { rows = [] } }
        }
    }

    private func delete(_ r: Row) async {
        deleting = nil
        do {
            _ = try await session.api.sendRaw("/api/artifacts/\(r.id)", method: "DELETE")
            withAnimation(Motion.morph) { rows?.removeAll { $0.id == r.id } }
        } catch {
            await load()
        }
    }
}
