#if DEBUG
// Debug only: `-designPreview <stage>` fills the model with fictional values so each screen can be looked at
// without the on-device model. Stages: start, error, checking, marks, draft, blocked, approved, sent.
// `-designScroll <id>` scrolls to one of the section ids after launch (top, original, marks, draft, approve, payload).
import SwiftUI

@MainActor
enum DesignPreview {
  private static func argument(after flag: String) -> String? {
    let args = ProcessInfo.processInfo.arguments
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
  }

  static var stage: String? { argument(after: "-designPreview") }
  static var scrollTarget: String? { argument(after: "-designScroll") }

  /// Built before the view exists, so ContentView's `onChange(of: raw)` never sees these values as an edit.
  static func makeModel() -> RespondentModel {
    let m = RespondentModel()
    guard let stage else { return m }
    m.raw = RespondentModel.sampleText
    guard stage != "start" else { return m }
    if stage == "error" {
      m.phase = .unavailable
      m.error = "On-device model unavailable (fictional preview). Nothing was sent to the cloud."
      return m
    }

    let marks = [
      SourceMark(risk: Risk(text: "only release lead", category: "uncommon role"), byAI: true, byRule: true),
      SourceMark(risk: Risk(text: "Maya", category: "name"), byAI: true, byRule: true),
      SourceMark(risk: Risk(text: "Tuesday", category: "weekday"), byAI: false, byRule: true),
    ]
    m.marks = marks
    m.modelName = "SystemLanguageModel (fictional preview)"
    let rewritten = "Handoff notes are sometimes hard to find. A shared checklist could help."

    switch stage {
    case "checking":
      m.phase = .checking
      m.modelName = ""
    case "marks":
      m.phase = .rewriting
    case "draft":
      m.draft = rewritten; m.phase = .ready
    case "blocked":
      m.draft = "The release lead chased Maya for the notes. A shared checklist could help."
      m.residuals = [Risk(text: "release lead", category: "uncommon role"), Risk(text: "Maya", category: "name")]
      m.phase = .ready
    case "approved":
      m.draft = rewritten; m.phase = .ready
      m.setApproved(true)
    case "sent":
      m.draft = rewritten; m.phase = .ready
      m.setApproved(true)
      m.send()
    default:
      break
    }
    return m
  }

  static func run(_ model: RespondentModel) async {
    guard stage != nil, let target = scrollTarget else { return }
    try? await Task.sleep(nanoseconds: 700_000_000)
    model.scrollTarget = target
  }
}
#endif
