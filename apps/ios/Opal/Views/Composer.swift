import SwiftUI

/// Something switched on for the next message, shown as a chip under the text (Study, Agents…).
struct ComposerChip: Identifiable {
    let id: String
    let label: String
    let systemImage: String
    let remove: () -> Void
}

/// The message box, as on the web: a single-line pill ("+", text, send) that grows into a rounded
/// card once the text wraps or something is attached. Text then spans the full width and the
/// buttons move to a row underneath. The corner radius is half the one-line height, so one line
/// is exactly a pill and the card keeps the same corners.
///
/// The text field is one view throughout (a custom `Layout` moves it), so the keyboard never
/// drops while the shape changes.
struct Composer<Menu: View>: View {
    @Binding var text: String
    var placeholder: String
    var busy: Bool
    var canSend: Bool
    var chips: [ComposerChip] = []
    var attachments: [PendingAttachment] = []
    var onRemoveAttachment: (String) -> Void = { _ in }
    @Binding var menuOpen: Bool
    /// The menu has grown into a large panel along the bottom of the screen (the camera).
    var menuExpanded = false
    var focus: FocusState<Bool>.Binding
    var onSend: () -> Void
    var onStop: () -> Void
    @ViewBuilder var menu: () -> Menu

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var box: CGRect = .zero
    @State private var textWidth: CGFloat = 0
    @State private var sent = 0

    private var width: CGFloat { box.width }
    /// How far the large panel sits in from the screen edges.
    private static var panelInset: CGFloat { 10 }

    /// Where the large panel goes, in window coordinates: the bottom half of the screen, inset
    /// from the edges, centred on the composer (so on iPad it stays over the chat column).
    private var panelFrame: CGRect {
        let screen = Screen.bounds
        let inset = Self.panelInset
        let w = min(box.width + 24 - inset * 2, 620)
        let h = (screen.height * 0.5).rounded()
        return CGRect(x: box.midX - w / 2, y: screen.height - inset - h, width: w, height: h)
    }

    private static var font: Font { .system(size: 17) }
    private static var button: CGFloat { 36 }
    private static var inset: CGFloat { 8 }

    private var expanded: Bool {
        if !attachments.isEmpty || !chips.isEmpty || text.contains("\n") { return true }
        let room = width - Self.inset * 2 - Self.button * 2 - ComposerLayout.gap * 2 - 4
        return width > 0 && textWidth > room
    }

    var body: some View {
        ComposerLayout(expanded: expanded) {
            plusButton
            field
            footer
            sendButton
            header
        }
        .background(alignment: .topLeading) { measurer }
        .opalGlass(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { box = $0 }
        .overlay(alignment: .topLeading) {
            if menuOpen {
                let target = panelFrame
                MenuPanel(
                    expanded: menuExpanded,
                    expandedSize: target.size,
                    expandedRadius: Screen.concentric(inset: Self.panelInset)
                ) { menu() }
                    // Sits just above the composer, growing up and out of the "+". Expanded, it
                    // moves down over the composer to fill the bottom of the screen.
                    .alignmentGuide(.top) { d in d[.bottom] + 10 }
                    .offset(
                        x: menuExpanded ? target.minX - box.minX : 0,
                        y: menuExpanded ? target.maxY - (box.minY - 10) : 0
                    )
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.modifier(active: PopOut(shown: 0), identity: PopOut(shown: 1)))
            }
        }
        .animation(Motion.morph, value: expanded)
        .sensoryFeedback(.impact(weight: .medium, intensity: 0.7), trigger: sent)
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    // MARK: Pieces (in ComposerLayout order)

    private var plusButton: some View {
        Button {
            focus.wrappedValue = false
            withAnimation(menuOpen ? Motion.dismiss : Motion.pop) { menuOpen.toggle() }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .regular))
                .rotationEffect(.degrees(menuOpen ? 45 : 0))
                .foregroundStyle(.primary)
                .frame(width: Self.button, height: Self.button)
                .background(menuOpen ? Color.wash : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(menuOpen ? "Close menu" : "Add files and more")
        .sensoryFeedback(.selection, trigger: menuOpen)
    }

    private var field: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .font(Self.font)
            .lineLimit(1...8)
            .focused(focus)
            .tint(Color.ink)
            .onChange(of: focus.wrappedValue) { _, focused in
                // Typing again closes the menu.
                if focused && menuOpen { withAnimation(Motion.dismiss) { menuOpen = false } }
            }
    }

    private var footer: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(chips) { chip in
                    HStack(spacing: 5) {
                        Image(systemName: chip.systemImage).font(.system(size: 12, weight: .medium))
                        Text(chip.label).font(.system(size: 14, weight: .medium))
                        Button {
                            withAnimation(Motion.morph) { chip.remove() }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                                .frame(width: 20, height: 20)
                                .contentShape(Circle())
                        }
                        .accessibilityLabel("Turn off \(chip.label)")
                    }
                    .foregroundStyle(Color.accentColor)
                    .padding(.leading, 10)
                    .padding(.trailing, 4)
                    .frame(height: 32)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
        }
        .scrollClipDisabled()
        .opacity(expanded ? 1 : 0)
    }

    private var sendButton: some View {
        let live = busy || canSend
        return Button {
            if busy { onStop() } else { sent += 1; onSend() }
        } label: {
            Image(systemName: busy ? "stop.fill" : "arrow.up")
                .font(.system(size: busy ? 13 : 16, weight: .bold))
                .foregroundStyle(live ? Color.canvas : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: Self.button, height: Self.button)
                .background(live ? Color.ink : Color.wash, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .disabled(!live)
        .animation(Motion.quick, value: live)
        .accessibilityLabel(busy ? "Stop" : "Send")
    }

    private var header: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { a in
                    AttachmentThumb(attachment: a) { onRemoveAttachment(a.id) }
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .padding(.top, 6)
            .padding(.horizontal, 2)
        }
        .scrollClipDisabled()
        .opacity(attachments.isEmpty ? 0 : 1)
    }

    /// The text on one line at its natural width, to tell when it no longer fits the pill.
    private var measurer: some View {
        Text(text.isEmpty ? " " : text)
            .font(Self.font)
            .lineLimit(1)
            .fixedSize()
            .hidden()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { textWidth = $0 }
            .accessibilityHidden(true)
    }
}

/// Places the composer's five pieces: lead (+), field, footer (chips), trail (send), header
/// (attachments). Collapsed: one row. Expanded: header, field, then lead/footer/trail.
struct ComposerLayout: Layout {
    var expanded: Bool
    static let gap: CGFloat = 6
    private let inset: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 360
        return CGSize(width: w, height: frames(width: w, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let f = frames(width: bounds.width, subviews: subviews)
        for (i, r) in f.rects.enumerated() where i < subviews.count {
            subviews[i].place(at: CGPoint(x: bounds.minX + r.minX, y: bounds.minY + r.minY), anchor: .topLeading, proposal: ProposedViewSize(width: r.width, height: r.height))
        }
    }

    private func frames(width w: CGFloat, subviews: Subviews) -> (rects: [CGRect], height: CGFloat) {
        guard subviews.count == 5 else { return ([], 0) }
        let gap = Self.gap
        let lead = subviews[0].sizeThatFits(.unspecified)
        let trail = subviews[3].sizeThatFits(.unspecified)
        let row = max(lead.height, trail.height)

        if !expanded {
            let fw = max(0, w - inset * 2 - lead.width - trail.width - gap * 2 - 4)
            let fh = subviews[1].sizeThatFits(ProposedViewSize(width: fw, height: nil)).height
            let h = max(row, fh) + inset * 2
            let fx = inset + lead.width + gap + 2
            return ([
                CGRect(x: inset, y: h - inset - lead.height, width: lead.width, height: lead.height),
                CGRect(x: fx, y: (h - fh) / 2, width: fw, height: fh),
                CGRect(x: fx, y: inset, width: 0, height: row),
                CGRect(x: w - inset - trail.width, y: h - inset - trail.height, width: trail.width, height: trail.height),
                CGRect(x: fx, y: inset, width: fw, height: 0),
            ], h)
        }

        let inner = w - inset * 2
        let headerH = subviews[4].sizeThatFits(ProposedViewSize(width: inner, height: nil)).height
        let hasHeader = headerH > 1
        var y = inset
        let headerR = CGRect(x: inset, y: y, width: inner, height: hasHeader ? headerH : 0)
        if hasHeader { y += headerH + gap }
        let fw = inner - 16
        let fh = subviews[1].sizeThatFits(ProposedViewSize(width: fw, height: nil)).height
        let fieldR = CGRect(x: inset + 8, y: y + 6, width: fw, height: fh)
        y = fieldR.maxY + 10
        let footW = max(0, inner - lead.width - trail.width - gap * 2)
        return ([
            CGRect(x: inset, y: y, width: lead.width, height: lead.height),
            fieldR,
            CGRect(x: inset + lead.width + gap, y: y + (row - 32) / 2, width: footW, height: 32),
            CGRect(x: w - inset - trail.width, y: y, width: trail.width, height: trail.height),
            headerR,
        ], y + row + inset)
    }
}

/// A picked file in the composer: a thumbnail for images, a name for anything else.
struct AttachmentThumb: View {
    let attachment: PendingAttachment
    let remove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = attachment.preview {
                    Image(uiImage: image).resizable().scaledToFill().frame(width: 60, height: 60)
                } else {
                    VStack(spacing: 4) {
                        Image(systemName: "doc").font(.system(size: 18))
                        Text(attachment.filename).font(.caption2).lineLimit(1)
                    }
                    .foregroundStyle(.secondary)
                    .padding(6)
                    .frame(width: 92, height: 60)
                    .background(Color.wash)
                }
            }
            .clipShape(.rect(cornerRadius: 14, style: .continuous))
            .overlay {
                switch attachment.state {
                case .uploading:
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.black.opacity(0.3))
                    ProgressView().tint(.white)
                case .failed:
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.red.opacity(0.35))
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.white)
                case .ready:
                    EmptyView()
                }
            }

            Button(action: remove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(.black.opacity(0.65), in: Circle())
                    .overlay { Circle().stroke(.white.opacity(0.9), lineWidth: 1.5) }
            }
            .offset(x: 6, y: -6)
            .accessibilityLabel("Remove \(attachment.filename)")
        }
    }
}

// MARK: Menu

/// The menu that grows out of the composer's "+": a glass panel above the composer. Expanded, the
/// same panel (so it morphs rather than swaps) becomes a large one whose corners follow the
/// screen's.
struct MenuPanel<Content: View>: View {
    var expanded = false
    var expandedSize: CGSize = .zero
    var expandedRadius: CGFloat = 40
    @ViewBuilder var content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: expanded ? expandedRadius : 28, style: .continuous)
        // A ZStack, so one page fades over the other instead of stacking under it mid-change.
        ZStack(alignment: .topLeading) { content }
            .padding(expanded ? 0 : 8)
            .frame(width: expanded ? expandedSize.width : 300, height: expanded ? expandedSize.height : nil, alignment: .topLeading)
            .clipShape(shape)
            .opalGlass(in: shape)
    }
}

/// Grows from the bottom-left corner (where the "+" is), sharpening out of a light blur.
struct PopOut: ViewModifier {
    var shown: CGFloat
    func body(content: Content) -> some View {
        content
            .scaleEffect(0.6 + 0.4 * shown, anchor: .bottomLeading)
            .opacity(shown)
            .blur(radius: (1 - shown) * 8)
    }
}

/// A row in a composer menu: an icon in a soft circle, a title with an optional hint, and a check
/// or a value on the right. Rows rise in one after another as the menu opens.
struct MenuRow: View {
    let title: String
    var subtitle: String?
    let systemImage: String
    var checked = false
    var value: String?
    var index = 0
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(checked ? Color.accentColor : .primary)
                    .frame(width: 36, height: 36)
                    .background(checked ? Color.accentColor.opacity(0.14) : Color.wash, in: Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 16, weight: .medium)).foregroundStyle(.primary)
                    if let subtitle {
                        Text(subtitle).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                if let value {
                    Text(value).font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(1)
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                } else if checked {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.accentColor)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 52)
            .contentShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(MenuRowStyle())
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared || reduceMotion ? 0 : 10)
        .onAppear {
            withAnimation(Motion.pop.delay(reduceMotion ? 0 : Double(index) * 0.03)) { appeared = true }
        }
        .animation(Motion.quick, value: checked)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

struct MenuRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.wash : .clear, in: .rect(cornerRadius: 18, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.quick, value: configuration.isPressed)
    }
}

/// Covers what's behind an open composer menu: blurred and a little dimmed, like Messages.
/// A tap closes the menu.
struct MenuScrim: View {
    @Binding var open: Bool
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(0.06)
        }
        .ignoresSafeArea()
        .opacity(open ? 1 : 0)
        .allowsHitTesting(open)
        .onTapGesture { withAnimation(Motion.dismiss) { open = false } }
        .animation(open ? Motion.pop : Motion.dismiss, value: open)
        .accessibilityHidden(true)
    }
}
