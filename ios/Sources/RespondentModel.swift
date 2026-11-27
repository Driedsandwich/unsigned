import Foundation
import SwiftUI

enum Phase: Equatable { case idle, checking, rewriting, ready, failed, unavailable }

struct SourceMark: Identifiable {
  let id = UUID()
  let risk: Risk
  let byAI: Bool
  let byRule: Bool
  var origin: String { byAI && byRule ? "AI + rule" : (byRule ? "rule" : "AI") }
}

@MainActor
final class RespondentModel: ObservableObject {
  static let questionID = "check-in-001"
  static let sampleText = "As the only release lead, I chased Maya on Tuesday for the notes. A shared checklist would help."

  @Published var raw = ""
  @Published var lang: Lang = .en
  @Published var phase: Phase = .idle
  @Published var marks: [SourceMark] = []
  @Published var draft = ""
  @Published var residuals: [Risk] = []
  @Published var modelName = ""
  @Published var approved = false
  @Published var sentPayload: [String: String]? = nil
  @Published var error = ""
  @Published var scrollTarget: String? = nil

  private let engine = OnDeviceEngine()
  private var aiRaw: [Risk] = []

  var busy: Bool { phase == .checking || phase == .rewriting }
  var sent: Bool { sentPayload != nil }
  var sourceRisks: [Risk] { marks.map { $0.risk } }
  var canApprove: Bool { phase == .ready && !draft.isEmpty && residuals.isEmpty && !sent }
  var deviceAvailabilityText: String { engine.availabilityText }
  var deviceAvailable: Bool { engine.isAvailable }

  func insertExample() {
    guard !sent else { return }
    resetDraft()
    raw = RespondentModel.sampleText
  }

  /// Called when the user edits the original: anything derived from the old text is dropped.
  func rawEdited() {
    guard !sent, phase != .idle, !busy else { return }
    resetDraft()
  }

  func resetDraft() {
    approved = false; draft = ""; residuals = []; marks = []; aiRaw = []; error = ""; modelName = ""; phase = .idle
  }

  func startOver() {
    sentPayload = nil; raw = ""; resetDraft()
  }

  func setApproved(_ value: Bool) { approved = value && canApprove }

  /// 1) on-device identifyRisks 2) deterministic marks 3) on-device rewrite 4) deterministic residual check.
  /// `afterIdentify` runs once the source marks are on screen (used by the demo runner to take a picture).
  func rewrite(afterIdentify: (() async -> Void)? = nil) async {
    guard !sent, !busy else { return }
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    resetDraft()
    guard engine.isAvailable else {
      phase = .unavailable
      error = "On-device model unavailable (\(engine.availabilityText)). Nothing was sent to the cloud."
      return
    }
    do {
      // Source risk check
      phase = .checking
      let candidates = try await identify(text)
      let rule = Domain.ruleBasedSourceRisks(text)
      let spans = try Domain.riskSpans(text, candidates, ruleRisks: rule)
      let merged = Domain.dedupeNestedRisks(Domain.mergeRisks([spans, rule]))
      let aiTexts = Set(spans.map { $0.text }), ruleTexts = Set(rule.map { $0.text })
      marks = merged.map { SourceMark(risk: $0, byAI: aiTexts.contains($0.text), byRule: ruleTexts.contains($0.text)) }
      if let hook = afterIdentify { await hook() }

      // Rewrite
      phase = .rewriting
      let reply = try await engine.respond(to: Prompts.rewrite(raw: text, lang: lang, flagged: merged))
      modelName = reply.modelName
      let rewritten = try Domain.text(reply.content, max: Domain.maxText)
      draft = rewritten
      residuals = Domain.residualRisks(rewritten, merged)
      phase = .ready
    } catch {
      phase = .failed
      self.error = "\(describe(error)). Your original text was not sent anywhere. Try again."
    }
  }

  private func identify(_ text: String) async throws -> Any {
    var lastError: Error = DomainError("Risk check failed")
    for _ in 0..<2 {   // one retry if the on-device model does not return JSON
      let reply = try await engine.respond(to: Prompts.identifyRisks(raw: text, lang: lang))
      modelName = reply.modelName
      do { return try Domain.parseJSON(reply.content) } catch { lastError = error }
    }
    throw lastError
  }

  private func describe(_ error: Error) -> String {
    if let d = error as? DomainError { return d.description }
    return String(String(describing: error).prefix(200))
  }

  /// Not sent anywhere in this build: the payload is only kept in memory and shown on screen.
  func send() {
    guard approved, canApprove else { return }
    guard let payload = try? Domain.validatePayload(["question_id": RespondentModel.questionID, "approved_rewrite": draft]) else {
      error = "Could not build the payload."; return
    }
    sentPayload = payload
    // Like the web app, the original and the draft are dropped once the approved text is kept.
    raw = ""; draft = ""; marks = []; residuals = []; approved = false
  }

  var payloadJSON: String {
    guard let p = sentPayload, let d = try? JSONSerialization.data(withJSONObject: p, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]) else { return "" }
    return String(data: d, encoding: .utf8) ?? ""
  }

  // MARK: highlighted text
  func highlighted(_ s: String, terms: [Risk], color: Color) -> AttributedString {
    var a = AttributedString(s)
    for t in terms {
      for r in Domain.literalSpans(s, t.text) {
        guard let sr = Range(r, in: s) else { continue }
        let lo = a.index(a.startIndex, offsetByCharacters: s.distance(from: s.startIndex, to: sr.lowerBound))
        let hi = a.index(a.startIndex, offsetByCharacters: s.distance(from: s.startIndex, to: sr.upperBound))
        a[lo..<hi].backgroundColor = color
        a[lo..<hi].foregroundColor = .black
      }
    }
    return a
  }
}
