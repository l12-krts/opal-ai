import SwiftUI

// The pieces every settings page is made of, like the web's settings-shell: a page with a short
// explanation, titled groups of rows in a card, and rows with a label and a control.

/// Settings or Customization: the list of pages. A main screen, so it has the sidebar button.
struct SettingsHome: View {
    let title: String
    let pages: [SettingsPage]
    @Environment(Shell.self) private var shell
    @Environment(SessionStore.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if title == "Settings", let name = session.userName {
                    HStack(spacing: 14) {
                        Avatar(name: name, size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(.system(size: 19, weight: .semibold))
                            if let email = session.email {
                                Text(email).font(.system(size: 14)).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                    .transition(.opacity)
                }
                SettingsCard {
                    ForEach(pages) { page in
                        Button { shell.open(.settings(page)) } label: {
                            SettingsRow(label: page.title, sub: subtitle(page), systemImage: page.systemImage) {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(RowButtonStyle())
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 32)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .animation(Motion.morph, value: session.userName)
        }
        .topBar { ScreenHeader { HeaderTitle(text: title) } }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func subtitle(_ page: SettingsPage) -> String {
        switch page {
        case .general: "Account, appearance, status"
        case .study: "eClass, textbooks, practice"
        case .handwriting: "Teach Opal your handwriting"
        case .secrets: "Passwords and keys agents asked for"
        case .memory: "What Opal remembers about you"
        case .skills: "Instructions for tasks you repeat"
        case .connectors: "Apps Opal and agents can use"
        case .codeGeneral: "Defaults for new threads"
        case .codeMachines: "Computers that run your agents"
        case .codeProjects: "Folders on your machines"
        case .codeSkills: "Instructions for coding agents"
        }
    }
}

/// One settings page, pushed on whatever is showing.
struct SettingsPageView: View {
    let page: SettingsPage

    var body: some View {
        Group {
            switch page {
            case .general: GeneralSettingsPage()
            case .study: StudySettingsPage()
            case .handwriting: HandwritingSettingsPage()
            case .secrets: SecretsSettingsPage()
            case .memory: MemorySettingsPage()
            case .skills: SkillsSettingsPage(kind: .chat)
            case .connectors: ConnectorsSettingsPage()
            case .codeGeneral: CodeGeneralSettingsPage()
            case .codeMachines: CodeMachinesSettingsPage()
            case .codeProjects: CodeProjectsSettingsPage()
            case .codeSkills: SkillsSettingsPage(kind: .code)
            }
        }
        .navigationTitle(page.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .background(Color.canvas.ignoresSafeArea())
    }
}

/// A page's scrolling body: an optional explanation, then the groups.
struct SettingsScroll<Content: View>: View {
    var info: String?
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if let info {
                    Text(info)
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 4)
                }
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 40)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

/// A titled group: a small heading (with an optional control on the right) over a card.
struct SettingsGroup<Content: View, Trailing: View>: View {
    var title: String?
    var info: String?
    var bare = false
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if title != nil || !(trailing is EmptyView) {
                HStack(alignment: .center, spacing: 10) {
                    if let title {
                        Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    trailing
                }
                .padding(.horizontal, 4)
                .frame(minHeight: 22)
            }
            if bare {
                content
            } else {
                SettingsCard { content }
            }
            if let info {
                Text(info)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
    }
}

extension SettingsGroup where Trailing == EmptyView {
    init(title: String? = nil, info: String? = nil, bare: Bool = false, @ViewBuilder content: () -> Content) {
        self.title = title
        self.info = info
        self.bare = bare
        self.trailing = EmptyView()
        self.content = content()
    }
}

/// The card rows sit in. Each row draws a hairline on its top edge; the card trims the first one.
struct SettingsCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.top, -1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.card)
            .clipShape(.rect(cornerRadius: 20, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5) }
    }
}

extension Color {
    /// Settings cards: a step off the canvas, like grouped table cells.
    static let card = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.11, alpha: 1) : UIColor(white: 0.965, alpha: 1) })
}

/// A row: icon, label (with a line under it), and a control on the right.
struct SettingsRow<Trailing: View>: View {
    let label: String
    var sub: String?
    var info: String?
    var systemImage: String?
    var icon: AnyView?
    var labelColor: Color = .primary
    var mono = false
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 13) {
            if let icon {
                icon.frame(width: 28)
            } else if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 16))
                    .foregroundStyle(labelColor == .primary ? Color.secondary : labelColor)
                    .frame(width: 24)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 16)).foregroundStyle(labelColor)
                if let sub, !sub.isEmpty {
                    Text(sub)
                        .font(.system(size: 13, design: mono ? .monospaced : .default))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let info {
                    Text(info)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(minHeight: 54)
        .contentShape(.rect)
        .overlay(alignment: .top) { RowDivider() }
    }
}

extension SettingsRow where Trailing == EmptyView {
    init(label: String, sub: String? = nil, info: String? = nil, systemImage: String? = nil, icon: AnyView? = nil, labelColor: Color = .primary, mono: Bool = false) {
        self.init(label: label, sub: sub, info: info, systemImage: systemImage, icon: icon, labelColor: labelColor, mono: mono) { EmptyView() }
    }
}

/// The hairline between rows, inset from the leading edge.
struct RowDivider: View {
    var body: some View {
        Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 0.5).padding(.leading, 16)
    }
}

/// Anything else that goes in a card (a field, a note), with the same hairline and padding.
struct CardSection<Content: View>: View {
    var padding: CGFloat = 12
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { RowDivider() }
    }
}

/// A row with nothing in it ("No secrets yet").
struct EmptyRow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .overlay(alignment: .top) { RowDivider() }
    }
}

/// Grey bars while a group loads.
struct SkeletonRows: View {
    var count = 2
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<count, id: \.self) { i in
                HStack(spacing: 13) {
                    RoundedRectangle(cornerRadius: 6).fill(Color.wash).frame(width: 22, height: 22)
                    VStack(alignment: .leading, spacing: 6) {
                        Capsule().fill(Color.wash).frame(width: i == 0 ? 140 : 110, height: 11)
                        Capsule().fill(Color.wash).frame(width: i == 0 ? 90 : 160, height: 9)
                    }
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                .overlay(alignment: .top) { RowDivider() }
            }
        }
        .transition(.opacity)
    }
}

/// A coloured dot and a word: is this working?
struct StatusPill: View {
    let ok: Bool
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(ok ? Color.success : Color.secondary.opacity(0.6)).frame(width: 7, height: 7)
            Text(text).font(.system(size: 14)).foregroundStyle(ok ? Color.primary : Color.secondary).lineLimit(1)
        }
    }
}

/// A small grey label (a version, a role).
struct Badge: View {
    let text: String
    var warning = false
    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(warning ? Color.warning : Color.secondary)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background((warning ? Color.warning : Color.primary).opacity(0.08), in: Capsule())
    }
}

/// Initials in a circle.
struct Avatar: View {
    let name: String
    var size: CGFloat = 32
    var body: some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        Circle()
            .fill(Color.wash)
            .overlay { Text(initials.isEmpty ? "?" : initials).font(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(.secondary) }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A row-shaped button: the row lights up while pressed.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.primary)
            .background(configuration.isPressed ? Color.primary.opacity(0.06) : .clear)
            .animation(Motion.quick, value: configuration.isPressed)
    }
}

/// A text field for settings forms: label above, filled box.
struct FormField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var secure = false
    var mono = false
    var keyboard: UIKeyboardType = .default
    var limit: Int?
    var info: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            FieldLabel(label)
            Group {
                if secure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboard)
                }
            }
            .font(.system(size: 16, design: mono ? .monospaced : .default))
            .textInputAutocapitalization(mono || keyboard != .default ? .never : .sentences)
            .autocorrectionDisabled(mono || keyboard != .default)
            .onChange(of: text) { _, v in if let limit, v.count > limit { text = String(v.prefix(limit)) } }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
            if let info {
                Text(info).font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A multi-line field for instructions and longer text.
struct FormEditor: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var minHeight: CGFloat = 200
    var mono = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            FieldLabel(label)
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.system(size: 15, design: mono ? .monospaced : .default))
                .lineLimit(8...)
                .padding(14)
                .frame(minHeight: minHeight, alignment: .topLeading)
                .background(Color.wash, in: .rect(cornerRadius: 14, style: .continuous))
        }
    }
}

/// What a settings page shows while a request fails.
struct ErrorNote: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(.system(size: 14))
            .foregroundStyle(Color.danger)
            .padding(.horizontal, 4)
            .transition(.opacity)
    }
}

/// A short message that slides in at the bottom and leaves on its own (the web's toast).
struct Toast: Equatable {
    let text: String
    var detail: String?
    var error = false
    let id = UUID()
}

extension View {
    func toast(_ toast: Binding<Toast?>) -> some View {
        modifier(ToastModifier(toast: toast))
    }
}

private struct ToastModifier: ViewModifier {
    @Binding var toast: Toast?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let t = toast {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: t.error ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(t.error ? Color.danger : Color.success)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.text).font(.system(size: 15, weight: .medium))
                            if let d = t.detail { Text(d).font(.system(size: 13)).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: 440)
                    .opalGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .id(t.id)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: t.id) {
                        try? await Task.sleep(for: .seconds(t.error ? 4 : 2.6))
                        withAnimation(Motion.dismiss) { if toast?.id == t.id { toast = nil } }
                    }
                    .onTapGesture { withAnimation(Motion.dismiss) { toast = nil } }
                }
            }
            .animation(Motion.pop, value: toast)
            .sensoryFeedback(trigger: toast) { _, new in
                guard let new else { return nil }
                return new.error ? .error : .success
            }
    }
}
