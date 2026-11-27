// Hands-free run for `-autorunDemo`: insert the fictional example, rewrite, approve if allowed, send.
// Saves screenshots to Documents/shots/NN_<stage>.png and a summary to Documents/result.json.
import SwiftUI
import UIKit
import os

@MainActor
enum Autorun {
  static var requested: Bool { ProcessInfo.processInfo.arguments.contains("-autorunDemo") }
  /// `-recordFrames` (with `-autorunDemo`): up to 10 frames a second to Documents/frames, plus a 1.2 s hold after each stage.
  static var recordFrames: Bool { ProcessInfo.processInfo.arguments.contains("-recordFrames") }

  private static var docs: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  private static var result: [String: Any] = [:]
  private static var stages: [[String: Any]] = []
  private static var shots: [String] = []

  private static func save() {
    result["stages"] = stages
    result["shots"] = shots
    if let d = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
      try? d.write(to: docs.appendingPathComponent("result.json"))
    }
  }

  private static func stage(_ name: String, ok: Bool, note: String = "") {
    stages.append(["name": name, "ok": ok, "note": note])
    save()
  }

  private static func snapshot(_ name: String, scrollTo target: String?, _ model: RespondentModel) async {
    if recordFrames { FrameRecorder.shared.setStage(name) }
    if let target {
      model.scrollTarget = nil
      try? await Task.sleep(nanoseconds: 100_000_000)
      model.scrollTarget = target
    }
    try? await Task.sleep(nanoseconds: 900_000_000)
    let dir = docs.appendingPathComponent("shots", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = String(format: "%02d_%@.png", shots.count + 1, name)
    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
          let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else {
      stage("shot:\(name)", ok: false, note: "no window"); return
    }
    let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
      window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
    if let png = image.pngData(), (try? png.write(to: dir.appendingPathComponent(file))) != nil {
      shots.append(file); save()
    } else {
      stage("shot:\(name)", ok: false, note: "write failed")
    }
    if recordFrames { try? await Task.sleep(nanoseconds: 1_200_000_000) }   // let the frame be readable in the video
  }

  private static func finishRecording() async {
    guard recordFrames else { return }
    let r = await FrameRecorder.shared.stop()
    result["frame_count"] = r.count
    result["frames_skipped"] = r.skipped
    save()
  }

  static func run(_ model: RespondentModel) async {
    // Start clean: the bundle id is shared with the earlier spike, so old files may exist.
    let fm = FileManager.default
    try? fm.removeItem(at: docs.appendingPathComponent("shots"))
    try? fm.removeItem(at: docs.appendingPathComponent("result.json"))
    result = ["started_at": ISO8601DateFormatter().string(from: Date()), "finished": false, "lang": model.lang.rawValue]
    save()
    if recordFrames { FrameRecorder.shared.start(framesDir: docs.appendingPathComponent("frames", isDirectory: true)) }
    try? await Task.sleep(nanoseconds: 800_000_000)

    await snapshot("start", scrollTo: "top", model)
    result["availability"] = model.deviceAvailabilityText
    if !model.deviceAvailable {
      model.raw = RespondentModel.sampleText
      await model.rewrite()
      stage("availability", ok: false, note: "On-device model unavailable")
      await snapshot("on_device_model_unavailable", scrollTo: "top", model)
      await snapshot("nothing_sent", scrollTo: "top", model)
      result["error"] = model.error; result["finished"] = true; save()
      await finishRecording()
      return
    }
    stage("availability", ok: true, note: model.deviceAvailabilityText)

    model.insertExample()
    stage("example_inserted", ok: model.raw == RespondentModel.sampleText)
    await snapshot("example_inserted", scrollTo: "original", model)

    await model.rewrite(afterIdentify: {
      stage("source_marks", ok: !model.marks.isEmpty, note: "\(model.marks.count) marks")
      await snapshot("source_marks", scrollTo: "marks", model)
    })
    result["device_model_name"] = model.modelName
    result["rewrite"] = model.draft
    result["source_mark_count"] = model.marks.count
    result["source_marks"] = model.marks.map { ["text": $0.risk.text, "category": $0.risk.category, "origin": $0.origin] }
    result["residual_count"] = model.residuals.count
    result["residuals"] = model.residuals.map { $0.text }
    result["phase_after_rewrite"] = String(describing: model.phase)
    result["can_approve"] = model.canApprove
    if !model.error.isEmpty { result["error"] = model.error }
    stage("rewrite", ok: model.phase == .ready, note: model.phase == .ready ? "ready" : model.error)
    await snapshot(model.phase == .ready ? "rewritten" : "rewrite_failed", scrollTo: "draft", model)

    if model.canApprove {
      model.setApproved(true)
      result["approved"] = model.approved
      stage("approve", ok: model.approved)
      await snapshot("approved", scrollTo: "approve", model)
      model.send()
      result["sent_payload"] = model.sentPayload ?? [:]
      stage("send", ok: model.sent, note: "kept in memory only; nothing uploaded")
      await snapshot("sent_payload", scrollTo: "payload", model)
    } else {
      result["approved"] = false
      stage("approve", ok: false, note: model.phase == .ready ? "blocked by remaining marked details" : "no draft")
      await snapshot("approval_blocked", scrollTo: "draft", model)
      result["sent_payload"] = NSNull()
    }
    result["finished"] = true
    save()
    await finishRecording()
  }
}

/// Continuous frames for a video of the hands-free run. Drawing happens on the main actor;
/// JPEG encoding and writing happen on a background queue, and a frame is skipped when the queue is backed up.
@MainActor
final class FrameRecorder {
  static let shared = FrameRecorder()

  private final class ImageBox: @unchecked Sendable { let image: UIImage; init(_ i: UIImage) { image = i } }

  private let interval = 0.1
  private let maxPending = 4
  private let queue = DispatchQueue(label: "unsigned.frames.write", qos: .utility)
  private let pending = OSAllocatedUnfairLock(initialState: 0)
  private var dir: URL?
  private var task: Task<Void, Never>?
  private var t0 = Date()
  private var stage = "start"
  private var entries: [[String: Any]] = []
  private var skipped = 0
  private var seq = 0

  func setStage(_ name: String) { stage = name }

  func start(framesDir: URL) {
    task?.cancel()
    try? FileManager.default.removeItem(at: framesDir)   // empty frames/ at the head of the run
    try? FileManager.default.createDirectory(at: framesDir, withIntermediateDirectories: true)
    dir = framesDir
    entries = []; skipped = 0; seq = 0; stage = "start"
    t0 = Date()
    task = Task { @MainActor [weak self] in
      var lastTick = -1
      while let self, !Task.isCancelled {
        let elapsed = Date().timeIntervalSince(self.t0)
        let tick = Int(elapsed / self.interval)
        if lastTick >= 0, tick > lastTick + 1 { self.skipped += tick - lastTick - 1 }   // ticks missed while drawing
        lastTick = tick
        self.capture()
        let wait = Double(tick + 1) * self.interval - Date().timeIntervalSince(self.t0)
        try? await Task.sleep(nanoseconds: UInt64(max(0.005, wait) * 1_000_000_000))
      }
    }
  }

  private func capture() {
    guard let dir else { return }
    guard pending.withLock({ $0 }) < maxPending else { skipped += 1; return }
    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
          let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else { skipped += 1; return }
    let ms = Int(Date().timeIntervalSince(t0) * 1000)
    let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
      window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
    seq += 1
    let name = String(format: "f_%05d.jpg", seq)
    entries.append(["file": name, "t_ms": ms, "stage": stage])
    pending.withLock { $0 += 1 }
    let box = ImageBox(image)
    let url = dir.appendingPathComponent(name)
    let pending = self.pending
    queue.async {
      if let data = box.image.jpegData(compressionQuality: 0.7) { try? data.write(to: url) }
      pending.withLock { $0 -= 1 }
    }
    if seq % 50 == 0 { writeIndex() }
  }

  private func writeIndex(finished: Bool = false) {
    guard let dir else { return }
    let doc: [String: Any] = [
      "fps_target": Int(1 / interval),
      "frame_count": entries.count,
      "skipped": skipped,
      "finished": finished,
      "frames": entries,
    ]
    if let d = try? JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
      try? d.write(to: dir.appendingPathComponent("index.json"))
    }
  }

  /// Stops the loop, waits for queued writes, writes index.json.
  func stop() async -> (count: Int, skipped: Int) {
    task?.cancel()
    task = nil
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in queue.async { c.resume() } }
    writeIndex(finished: true)
    return (entries.count, skipped)
  }
}
