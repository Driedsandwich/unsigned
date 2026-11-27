import SwiftUI

struct ContentView: View {
  @ObservedObject var model: RespondentModel
  private let mark = Theme.mark

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          header.id("top")
          VStack(alignment: .leading, spacing: 16) {
            questionBlock
            original.id("original")
            if !model.error.isEmpty { errorBanner }
            if !model.sent && (model.phase == .rewriting || model.phase == .ready || !model.draft.isEmpty) { draftSection.id("draft") }
            timeline
            if model.phase == .ready || model.sent { approval.id("approve").padding(.top, model.sent ? -16 : 0) }
            if model.sent { payload.id("payload") }
            Color.clear.frame(height: 420)
          }
          .padding(.horizontal, Theme.gutter)
          .padding(.top, 20)
        }
      }
      .background(Theme.bg.ignoresSafeArea())
      .overlay(alignment: .top) {
        // Keeps scrolled content from showing through the status bar.
        GeometryReader { g in
          Theme.headerBg.frame(height: g.safeAreaInsets.top).offset(y: -g.safeAreaInsets.top)
        }
        .allowsHitTesting(false)
      }
      .scrollDismissesKeyboard(.interactively)
      .onChange(of: model.scrollTarget) { _, target in
        guard let target else { return }
        withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(target, anchor: .top) }
      }
    }
    .preferredColorScheme(.light)
  }

  // MARK: sections
  private var header: some View {
    HStack(spacing: 12) {
      Text("Unsigned").type(.display, .bold).tracking(-1)
      Spacer(minLength: 8)
      Pill(text: "AI · On device")
    }
    .padding(.horizontal, Theme.gutter)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, minHeight: 66)
    .background(Theme.headerBg.ignoresSafeArea(edges: .top))
    .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
  }

  private var questionBlock: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Question 1 of 1").type(.label, color: Theme.muted)
      Text("What would make handoffs easier?").type(.question, .bold)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var original: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your words · Private").type(.body, .semibold)
      TextEditor(text: $model.raw)
        .scrollContentBackground(.hidden)
        .font(.system(size: 16))
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .frame(minHeight: 126)
        .inputBox()
        .disabled(model.sent || model.busy)
        .accessibilityIdentifier("rawText")
        .onChange(of: model.raw) { _, _ in model.rawEdited() }
      VStack(alignment: .leading, spacing: 2) {
        Label("Never leaves this device.", systemImage: "lock.fill").type(.caption, color: Theme.green)
        Text("Only the version you approve can be sent.").type(.caption, color: Theme.muted)
      }
      Button("Insert fictional example") { model.insertExample() }
        .buttonStyle(TextLinkStyle())
        .disabled(model.sent || model.busy)
      Button { Task { await model.rewrite() } } label: {
        Text(model.phase == .checking ? "Checking details…" : model.phase == .rewriting ? "Rewriting…" : "Rewrite on this device")
      }
      .buttonStyle(WideButtonStyle())
      .disabled(model.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy || model.sent)
      if model.sent {
        Button("Start another fictional response") { model.startOver() }.buttonStyle(WideButtonStyle(prominent: false))
      }
      if !model.marks.isEmpty { sourceMarks.id("marks") }
    }
    .card()
  }

  private var errorBanner: some View {
    Text(model.error).type(.label, .semibold, color: Theme.warnInk)
      .padding(.horizontal, 12).padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.warnBg, in: RoundedRectangle(cornerRadius: Theme.inputRadius))
      .overlay(RoundedRectangle(cornerRadius: Theme.inputRadius).stroke(Theme.warnLine, lineWidth: 1.5))
  }

  private var sourceMarks: some View {
    VStack(alignment: .leading, spacing: 8) {
      Rectangle().fill(Theme.line).frame(height: 1).padding(.top, 4)
      Text("Potential identifying details").type(.body, .semibold)
      Text(model.highlighted(model.raw, terms: model.sourceRisks, color: mark, foreground: Theme.ink))
        .font(.system(size: 16))
        .foregroundStyle(Theme.ink)
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .inputBox(fill: Theme.soft)
      ForEach(model.marks) { m in
        HStack(spacing: 8) {
          Text(m.risk.text).type(.label, .semibold)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(mark, in: RoundedRectangle(cornerRadius: 4))
          Text(m.risk.category).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.mutedDeep)
          Spacer(minLength: 4)
          Text(m.origin).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.mutedDeep)
        }
        .frame(minHeight: 28)
      }
      Text("Marks come from the on-device AI and from fixed rules for names, weekdays, dates and sole roles.")
        .type(.caption, color: Theme.muted)
    }
  }

  /// The "On-device AI" bridge, then the pale draft card.
  private var draftSection: some View {
    VStack(spacing: 0) {
      bridge
      draftCard
    }
  }

  private var bridge: some View {
    ZStack {
      Rectangle().fill(Theme.connector).frame(width: 1)
      Pill(text: "On-device AI", dot: true, border: Color(hex: 0xD1E5DA))
      VStack {
        Spacer()
        Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.green)
      }
      .padding(.bottom, 2)
    }
    .frame(height: 56)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("On-device AI")
  }

  private var draftCard: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("Live neutral draft").type(.section, .bold)
        Spacer(minLength: 4)
        if model.phase == .rewriting {
          Text("Rewriting…").type(.caption, color: Theme.green)
        } else if model.phase == .ready && model.residuals.isEmpty {
          Label("Ready to review", systemImage: "checkmark.circle.fill").type(.caption, color: Theme.green)
        }
      }
      if model.draft.isEmpty {
        Text("Rewriting on this device…").type(.body, color: Theme.muted)
          .padding(12).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
          .inputBox(fill: Color.white.opacity(0.9))
      } else {
        Text(model.highlighted(model.draft, terms: model.residuals, color: mark, foreground: Theme.ink))
          .font(.system(size: 16))
          .foregroundStyle(Theme.ink)
          .lineSpacing(3)
          .padding(12).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
          .inputBox(fill: Color.white.opacity(0.9))
      }
      if !model.modelName.isEmpty {
        Label("Ran on device · \(model.modelName)", systemImage: "iphone").type(.label, color: Theme.muted)
      }
      if model.phase == .ready {
        if model.residuals.isEmpty {
          Label("No marked details remain in this draft.", systemImage: "checkmark.circle").type(.label, color: Theme.green)
        } else {
          Label("Details remaining in this draft: " + model.residuals.map { $0.text }.joined(separator: ", "), systemImage: "exclamationmark.triangle.fill")
            .type(.label, .semibold, color: Theme.warnInk)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.warnBg, in: RoundedRectangle(cornerRadius: Theme.inputRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.inputRadius).stroke(Theme.warnLine, lineWidth: 1.5))
        }
      }
    }
    .card(fill: Theme.pale, border: Theme.draftLine)
  }

  private var timeline: some View {
    let steps: [(String, String)] = [
      ("Typed here", "Private"),
      ("Rewritten here", "On device"),
      ("Approved rewrite only", "Shown here, not uploaded"),
    ]
    return VStack(alignment: .leading, spacing: 12) {
      Text("What leaves your device").type(.section, .bold)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
          HStack(alignment: .top, spacing: 12) {
            Text("\(i + 1)").type(.label, .semibold)
              .monospacedDigit()
              .frame(width: 26, height: 26)
              .background(Theme.stepBg, in: Circle())
            (Text(s.0) + Text(" · ") + Text(s.1)).type(.body)
              .frame(maxWidth: .infinity, minHeight: 26, alignment: .leading)
          }
          .padding(.bottom, i == steps.count - 1 ? 0 : 12)
          .background(alignment: .topLeading) {
            if i < steps.count - 1 {
              Rectangle().fill(Theme.connector).frame(width: 1).padding(.top, 26).padding(.leading, 12)
            }
          }
        }
      }
      .accessibilityElement(children: .combine)
    }
    .card()
  }

  private var approval: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !model.sent {
        VStack(alignment: .leading, spacing: 8) {
          Toggle("I approve this version", isOn: Binding(get: { model.approved }, set: { model.setApproved($0) }))
            .toggleStyle(SquareCheckStyle())
            .disabled(!model.canApprove)
            .accessibilityIdentifier("approveToggle")
          if !model.canApprove {
            Text("Approval is blocked while marked details remain in the draft. Rewrite again.")
              .type(.label, .semibold, color: Theme.warnInk)
          }
          Button("Send approved response") { model.send() }
            .buttonStyle(WideButtonStyle())
            .disabled(!model.approved)
          Text("Nothing is uploaded in this build. Sending only shows the approved text on this screen.")
            .type(.caption, color: Theme.muted)
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
        }
        .card()
      }
    }
  }

  private var payload: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Approved response kept on this screen", systemImage: "checkmark.seal.fill")
        .type(.body, .semibold, color: Theme.green)
      Text(model.payloadJSON)
        .font(.system(size: 13, design: .monospaced))
        .foregroundStyle(Theme.ink)
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .inputBox()
        .textSelection(.enabled)
      Text("Nothing is uploaded in this build. This is the only content that would be sent: the question ID and the text you approved.")
        .type(.caption, color: Theme.muted)
    }
    .card(fill: Theme.pale, border: Theme.draftLine)
  }
}
