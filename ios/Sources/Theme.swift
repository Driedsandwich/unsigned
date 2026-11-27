import SwiftUI

/// Colors, type steps and small shared pieces from DESIGN.md (A3) and src/style.css.
enum Theme {
  static let bg = Color(hex: 0xF4F6F4)
  static let headerBg = Color(hex: 0xFAFCFA)
  static let surface = Color.white
  static let ink = Color(hex: 0x172C2A)
  static let muted = Color(hex: 0x526560)
  static let green = Color(hex: 0x236C60)
  static let pale = Color(hex: 0xE4F1EB)
  static let line = Color(hex: 0xCBD8D2)
  static let draftLine = Color(hex: 0xD1E3DA)
  static let connector = Color(hex: 0x91ADA3)
  static let stepBg = Color(hex: 0xD9EDE3)
  static let checkBorder = Color(hex: 0x819B91)
  static let soft = Color(hex: 0xEDF2EE)
  // Web `mark` (the identifying-detail highlight) and the advisory note.
  static let mark = Color(hex: 0xFBE7B7)
  static let warnBg = Color(hex: 0xFFF6E8)
  static let warnLine = Color(hex: 0xC9892B)
  static let warnInk = Color(hex: 0x5C3D0D)

  static let cardRadius: CGFloat = 12
  static let inputRadius: CGFloat = 8
  static let gutter: CGFloat = 16
}

extension Color {
  init(hex: UInt32) {
    self.init(.sRGB,
              red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255,
              opacity: 1)
  }
}

/// DESIGN.md Mobile type steps (size / line height). SF is used instead of Inter.
enum TypeStep {
  case display, section, question, body, label, button, caption

  var size: CGFloat {
    switch self {
    case .display: return 26
    case .section: return 20
    case .question: return 18
    case .body, .button: return 16
    case .label: return 13
    case .caption: return 12
    }
  }
  var line: CGFloat {
    switch self {
    case .display: return 32
    case .section: return 26
    case .question: return 25
    case .body, .button: return 22
    case .label: return 18
    case .caption: return 17
    }
  }
}

extension View {
  func type(_ step: TypeStep, _ weight: Font.Weight = .regular, color: Color = Theme.ink) -> some View {
    self.font(.system(size: step.size, weight: weight))
      .lineSpacing(max(0, step.line - step.size * 1.19))
      .foregroundStyle(color)
  }

  /// White card with a 1px border and a 12 radius.
  func card(fill: Color = Theme.surface, border: Color = Theme.line) -> some View {
    self.padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(fill, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
      .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(border, lineWidth: 1))
  }

  /// Text area / read-only text box: white, 1px border, 8 radius.
  func inputBox(fill: Color = .white, border: Color = Theme.line) -> some View {
    self.background(fill, in: RoundedRectangle(cornerRadius: Theme.inputRadius))
      .overlay(RoundedRectangle(cornerRadius: Theme.inputRadius).stroke(border, lineWidth: 1))
  }
}

/// Pale pill with an optional dot ("AI · On device", "On-device AI").
struct Pill: View {
  let text: String
  var dot = false
  var border: Color? = nil

  var body: some View {
    HStack(spacing: 7) {
      if dot { Circle().fill(Theme.green).frame(width: 6, height: 6) }
      Text(text).type(.label, .semibold, color: Theme.green).lineLimit(1)
    }
    .padding(.horizontal, dot ? 18 : 12)
    .padding(.vertical, 5)
    .background(Theme.pale, in: Capsule())
    .overlay(Capsule().stroke(border ?? .clear, lineWidth: 1))
    .fixedSize()
  }
}

/// Full-width primary (filled green) or secondary (outlined) button, at least 44pt high.
struct WideButtonStyle: ButtonStyle {
  var prominent = true
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .type(.button, .semibold, color: prominent ? .white : Theme.green)
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity, minHeight: 48)
      .padding(.horizontal, 16)
      .background(prominent ? Theme.green : Color.clear, in: RoundedRectangle(cornerRadius: Theme.inputRadius))
      .overlay(RoundedRectangle(cornerRadius: Theme.inputRadius).stroke(Theme.green, lineWidth: 1))
      .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
      .contentShape(RoundedRectangle(cornerRadius: Theme.inputRadius))
  }
}

/// Underlined green text button ("Insert fictional example").
struct TextLinkStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .type(.label, .semibold, color: Theme.green)
      .underline(true, color: Theme.green)
      .frame(minHeight: 44, alignment: .leading)
      .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
      .contentShape(Rectangle())
  }
}

/// Square check mark used for "I approve this version" (the control stays a Toggle).
struct SquareCheckStyle: ToggleStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    Button { configuration.isOn.toggle() } label: {
      HStack(spacing: 10) {
        ZStack {
          RoundedRectangle(cornerRadius: 5)
            .fill(configuration.isOn ? Theme.green : Color.white)
          RoundedRectangle(cornerRadius: 5)
            .stroke(configuration.isOn ? Theme.green : Theme.checkBorder, lineWidth: 1.5)
          if configuration.isOn {
            Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
          }
        }
        .frame(width: 24, height: 24)
        configuration.label.type(.button, .semibold)
        Spacer(minLength: 0)
      }
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .opacity(enabled ? 1 : 0.45)
  }
}
