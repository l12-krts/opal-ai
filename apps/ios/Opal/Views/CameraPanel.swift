import AVFoundation
import SwiftUI

/// The camera, run on its own queue so starting and switching never stalls the interface.
final class Camera: NSObject, @unchecked Sendable, AVCapturePhotoCaptureDelegate {
    enum Access: Sendable { case unknown, allowed, denied, unavailable }

    /// One camera for the app; the session is costly to set up.
    static let shared = Camera()

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "app.opal.camera")
    private let output = AVCapturePhotoOutput()
    private var input: AVCaptureDeviceInput?
    private var pending: CheckedContinuation<Data?, Never>?

    static func access() async -> Access {
        guard AVCaptureDevice.default(for: .video) != nil else { return .unavailable }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .allowed
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video) ? .allowed : .denied
        default: return .denied
        }
    }

    func start() {
        queue.async { [self] in
            if input == nil {
                session.beginConfiguration()
                session.sessionPreset = .photo
                use(.back)
                if session.canAddOutput(output) { session.addOutput(output) }
                session.commitConfiguration()
            }
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in if session.isRunning { session.stopRunning() } }
    }

    func flip() {
        queue.async { [self] in
            session.beginConfiguration()
            use(input?.device.position == .front ? .back : .front)
            session.commitConfiguration()
        }
    }

    /// Takes a photo and returns it as JPEG/HEIC file data, or nil if it failed.
    func capture() async -> Data? {
        await withCheckedContinuation { (c: CheckedContinuation<Data?, Never>) in
            queue.async { [self] in
                guard session.isRunning, pending == nil else { c.resume(returning: nil); return }
                pending = c
                output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
            }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: (any Error)?) {
        let data = error == nil ? photo.fileDataRepresentation() : nil
        queue.async { [self] in
            pending?.resume(returning: data)
            pending = nil
        }
    }

    /// Call on `queue`, inside a configuration block.
    private func use(_ position: AVCaptureDevice.Position) {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let next = try? AVCaptureDeviceInput(device: device) else { return }
        if let input { session.removeInput(input) }
        if session.canAddInput(next) {
            session.addInput(next)
            input = next
        } else if let input, session.canAddInput(input) {
            session.addInput(input)
        }
    }
}

/// The live picture from the camera, filling its frame.
struct CameraPreview: UIViewRepresentable {
    let camera: Camera

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.backgroundColor = .black
        view.preview.videoGravity = .resizeAspectFill
        view.preview.session = camera.session
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}

/// What the "+" menu turns into when you pick Camera: a viewfinder with a shutter. A photo you
/// take is attached to the message and the panel folds away.
struct CameraPanel: View {
    let onPhoto: (Data) -> Void
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let camera = Camera.shared
    @State private var access: Camera.Access = .unknown
    @State private var flash = false
    @State private var capturing = false
    @State private var shots = 0
    @State private var flips = 0

    var body: some View {
        ZStack {
            Color.black
            switch access {
            case .allowed:
                CameraPreview(camera: camera).transition(.opacity)
            case .denied:
                notice("Opal can't use the camera", detail: "Allow camera access for Opal in Settings.", action: "Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            case .unavailable:
                notice("No camera here", detail: "This device doesn't have a camera Opal can use.", action: nil) {}
            case .unknown:
                EmptyView()
            }
            // The shutter flash.
            Color.white.opacity(flash ? 0.8 : 0).allowsHitTesting(false)
        }
        .overlay(alignment: .topLeading) {
            roundButton("xmark", label: "Close camera", action: onClose).padding(14)
        }
        .overlay(alignment: .bottom) {
            if access == .allowed { controls.transition(.opacity) }
        }
        .animation(.easeOut(duration: 0.25), value: access)
        .sensoryFeedback(.impact(weight: .medium), trigger: shots)
        .sensoryFeedback(.selection, trigger: flips)
        .task {
            access = await Camera.access()
            if access == .allowed { camera.start() }
        }
        .onDisappear { camera.stop() }
    }

    private var controls: some View {
        HStack {
            Color.clear.frame(width: 44, height: 44)
            Spacer()
            Button(action: shoot) {
                Circle()
                    .fill(.white)
                    .padding(5)
                    .overlay { Circle().stroke(.white, lineWidth: 3) }
                    .frame(width: 70, height: 70)
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .disabled(capturing)
            .accessibilityLabel("Take photo")
            Spacer()
            roundButton("arrow.triangle.2.circlepath", label: "Switch camera") {
                flips += 1
                camera.flip()
            }
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 20)
    }

    private func roundButton(_ systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.35), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.92))
        .accessibilityLabel(label)
    }

    private func notice(_ title: String, detail: String, action: String?, perform: @escaping () -> Void) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "camera").font(.system(size: 28, weight: .light))
            Text(title).font(.system(size: 17, weight: .semibold))
            Text(detail).font(.system(size: 14)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
            if let action {
                Button(action, action: perform)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .background(.white, in: Capsule())
                    .buttonStyle(PressableStyle())
                    .padding(.top, 6)
            }
        }
        .foregroundStyle(.white)
        .padding(28)
    }

    private func shoot() {
        capturing = true
        shots += 1
        if !reduceMotion {
            withAnimation(.linear(duration: 0.05)) { flash = true }
            Task {
                try? await Task.sleep(for: .milliseconds(70))
                withAnimation(.easeOut(duration: 0.35)) { flash = false }
            }
        }
        Task {
            let data = await camera.capture()
            capturing = false
            if let data { onPhoto(data) }
        }
    }
}
