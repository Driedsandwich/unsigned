// Hands-free run for `-autorunDemo`: insert the fictional example, rewrite, approve if allowed, send.
// Saves screenshots to Documents/shots/NN_<stage>.png and a summary to Documents/result.json.
import SwiftUI
import UIKit

@MainActor
enum Autorun {
  static var requested: Bool { ProcessInfo.processInfo.arguments.contains("-autorunDemo") }

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
  }

  static func run(_ model: RespondentModel) async {
    // Start clean: the bundle id is shared with the earlier spike, so old files may exist.
    let fm = FileManager.default
    try? fm.removeItem(at: docs.appendingPathComponent("shots"))
    try? fm.removeItem(at: docs.appendingPathComponent("result.json"))
    result = ["started_at": ISO8601DateFormatter().string(from: Date()), "finished": false, "lang": model.lang.rawValue]
    save()
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
  }
}
