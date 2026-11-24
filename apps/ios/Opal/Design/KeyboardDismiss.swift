import SwiftUI
import UIKit

/// A tap anywhere outside the keyboard puts it away, on every screen: one tap recognizer on the
/// window that ends editing. It never cancels the tap, so buttons, rows and links still work, and
/// it ignores taps in a text field (moving the cursor) and on the composer (so Send keeps the
/// keyboard up, like Messages).
@MainActor
final class KeyboardDismiss: NSObject, UIGestureRecognizerDelegate {
    static let shared = KeyboardDismiss()
    private var windows = Set<ObjectIdentifier>()

    func install(on window: UIWindow) {
        guard windows.insert(ObjectIdentifier(window)).inserted else { return }
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        window.addGestureRecognizer(tap)
    }

    @objc private func tapped(_ tap: UITapGestureRecognizer) {
        tap.view?.endEditing(true)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var view = touch.view
        while let v = view {
            if v is UITextField || v is UITextView { return false }
            view = v.superview
        }
        let point = touch.location(in: nil)
        if Flight.composer.insetBy(dx: -4, dy: -6).contains(point) { return false }
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

/// Installs `KeyboardDismiss` on the window this view ends up in.
struct KeyboardDismissInstaller: UIViewRepresentable {
    final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let window { KeyboardDismiss.shared.install(on: window) }
        }
    }

    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: Probe, context: Context) {}
}
