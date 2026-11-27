import SwiftUI

struct ContentView: View {
  @ObservedObject var model: RespondentModel
  private let mark = Color.yellow

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          header.id("top")
          original.id("original")
          if !model.error.isEmpty { errorBanner }
          if !model.marks.isEmpty { sourceMarks.id("marks") }
          if !model.sent && (model.phase == .rewriting || model.phase == .ready || !model.draft.isEmpty) { draftSection.id("draft") }
          if model.phase == .ready || model.sent { approval.id("approve") }
          if model.sent { payload.id("payload") }
          Color.clear.frame(height: 420)
        }
        .padding()
      }
      .scrollDismissesKeyboard(.interactively)
      .onChange(of: model.scrollTarget) { _, target in
        guard let target else { return }
        withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(target, anchor: .top) }
      }
    }
  }

  // MARK: sections
  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("A little clarity, every week").font(.caption).foregroundStyle(.secondary)
      Text("This week’s check-in").font(.title2.bold())
      Text("Question 1 of 1").font(.caption).foregroundStyle(.secondary)
      Text("What would make handoffs easier?").font(.headline).padding(.top, 4)
    }
  }

  private var original: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Your words · Private").font(.subheadline.weight(.semibold))
        Spacer()
        Label("Never leaves this device", systemImage: "lock.fill").font(.caption).foregroundStyle(.green)
      }
      TextEditor(text: $model.raw)
        .frame(minHeight: 110)
        .padding(6)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.4)))
        .disabled(model.sent || model.busy)
        .accessibilityIdentifier("rawText")
        .onChange(of: model.raw) { _, _ in model.rawEdited() }
      Text("Only the version you approve can be sent.").font(.caption).foregroundStyle(.secondary)
      HStack {
        Button("Insert fictional example") { model.insertExample() }
          .buttonStyle(.bordered).disabled(model.sent || model.busy)
        Button { Task { await model.rewrite() } } label: {
          Text(model.phase == .checking ? "Checking details…" : model.phase == .rewriting ? "Rewriting…" : "Rewrite on this device")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy || model.sent)
      }
      if model.sent {
        Button("Start another fictional response") { model.startOver() }.buttonStyle(.bordered)
      }
    }
  }

  private var errorBanner: some View {
    Text(model.error).font(.callout).padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
  }

  private var sourceMarks: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Potential identifying details").font(.subheadline.weight(.semibold))
      Text(model.highlighted(model.raw, terms: model.sourceRisks, color: mark))
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
      ForEach(model.marks) { m in
        HStack {
          Text(m.risk.text).padding(.horizontal, 6).background(mark).foregroundStyle(.black).clipShape(RoundedRectangle(cornerRadius: 4))
          Text(m.risk.category).font(.caption).foregroundStyle(.secondary)
          Spacer()
          Text(m.origin).font(.caption2).foregroundStyle(.secondary)
        }
      }
      Text("Marks come from the on-device AI and from fixed rules for names, weekdays, dates and sole roles.")
        .font(.caption).foregroundStyle(.secondary)
    }
  }

  private var draftSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Neutral draft to review").font(.subheadline.weight(.semibold))
      if model.draft.isEmpty {
        Text("Rewriting on this device…").foregroundStyle(.secondary)
      } else {
        Text(model.highlighted(model.draft, terms: model.residuals, color: mark))
          .padding(8).frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
      }
      if !model.modelName.isEmpty {
        Label("Ran on device · \(model.modelName)", systemImage: "iphone").font(.caption).foregroundStyle(.secondary)
      }
      if model.phase == .ready {
        if model.residuals.isEmpty {
          Label("No marked details remain in this draft.", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.green)
        } else {
          Label("Details remaining in this draft: " + model.residuals.map { $0.text }.joined(separator: ", "), systemImage: "exclamationmark.triangle.fill")
            .font(.caption).foregroundStyle(.orange)
        }
      }
    }
  }

  private var approval: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !model.sent {
        Toggle("I approve this version", isOn: Binding(get: { model.approved }, set: { model.setApproved($0) }))
          .disabled(!model.canApprove)
          .accessibilityIdentifier("approveToggle")
        if !model.canApprove {
          Text("Approval is blocked while marked details remain in the draft. Rewrite again.")
            .font(.caption).foregroundStyle(.orange)
        }
        Button("Send approved response") { model.send() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.approved)
      }
    }
  }

  private var payload: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Approved response kept on this screen", systemImage: "checkmark.seal").font(.subheadline.weight(.semibold))
      Text(model.payloadJSON)
        .font(.system(.footnote, design: .monospaced))
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .textSelection(.enabled)
      Text("Nothing is uploaded in this build. This is the only content that would be sent: the question ID and the text you approved.")
        .font(.caption).foregroundStyle(.secondary)
    }
  }
}
