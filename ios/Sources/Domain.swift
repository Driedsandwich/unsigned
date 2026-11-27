// Port of the deterministic parts of src/domain.js (Foundation only; no Firebase, no SwiftUI).
// Offsets are UTF-16 (NSString) to match JavaScript string indices.
import Foundation

struct Risk: Equatable, Hashable {
  var text: String
  var category: String
  var sourceRiskIndex: Int? = nil
}

struct DomainError: Error, CustomStringConvertible {
  let description: String
  init(_ d: String) { description = d }
}

enum Domain {
  static let maxText = 1200

  // MARK: helpers
  static func ns(_ s: String) -> NSString { s as NSString }
  static func len(_ s: String) -> Int { (s as NSString).length }
  static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
    // Patterns are literals in this file or escaped terms; a failure is a programming error.
    try! NSRegularExpression(pattern: pattern, options: options)
  }
  static func matches(_ re: NSRegularExpression, in s: String) -> [NSTextCheckingResult] {
    re.matches(in: s, options: [], range: NSRange(location: 0, length: len(s)))
  }
  static func test(_ re: NSRegularExpression, _ s: String) -> Bool {
    re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: len(s))) != nil
  }
  static func sub(_ s: String, _ r: NSRange) -> String { ns(s).substring(with: r) }
  static func includes(_ s: String, _ t: String) -> Bool { ns(s).range(of: t).location != NSNotFound }
  static func escape(_ s: String) -> String { NSRegularExpression.escapedPattern(for: s) }
  static func hasJapanese(_ s: String) -> Bool { test(regex(#"[぀-ヿ一-鿿]"#), s) }

  // MARK: text / JSON
  static func text(_ value: String, max: Int = maxText) throws -> String {
    let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty || len(t) > max { throw DomainError("Invalid text") }
    return t
  }

  /// Same fence stripping as parseJSON in domain.js. Throws if the output is not JSON.
  static func parseJSON(_ value: String) throws -> Any {
    var s = value.trimmingCharacters(in: .whitespacesAndNewlines)
    s = s.replacingOccurrences(of: #"^```(?:json)?\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
    s = s.replacingOccurrences(of: #"\s*```$"#, with: "", options: .regularExpression)
    guard let data = s.data(using: .utf8) else { throw DomainError("Not JSON") }
    do { return try JSONSerialization.jsonObject(with: data, options: []) }
    catch { throw DomainError("Model output was not JSON") }
  }

  // MARK: constants
  static let specificRiskCategories: Set<String> = ["name", "date", "weekday", "uncommon role"]
  static let enMonth = regex(#"(?<![\p{L}\p{N}])(?:January|February|March|April|May|June|July|August|September|October|November|December)(?![\p{L}\p{N}])"#)

  static let weekdays: [(String, String?)] = [
    ("Monday", "Mon"), ("Tuesday", "Tue"), ("Wednesday", "Wed"), ("Thursday", "Thu"), ("Friday", "Fri"),
    ("Saturday", "Sat"), ("Sunday", "Sun"),
    ("月曜日", "月曜"), ("火曜日", "火曜"), ("水曜日", "水曜"), ("木曜日", "木曜"), ("金曜日", "金曜"),
    ("土曜日", "土曜"), ("日曜日", "日曜"),
  ]
  static let roleAliases: [[String]] = [
    ["qa", "quality assurance", "quality analyst", "tester", "testers", "testing", "test engineer", "品質保証", "テスター", "検証担当", "品質管理"],
    ["release lead", "release manager", "release coordinator", "リリース担当", "リリースリード"],
    ["designer", "designers", "design specialist", "デザイナー"],
    ["analyst", "analysts", "analysis specialist", "アナリスト", "分析担当"],
  ]
  static let soleMarkersJA = ["一人で", "一人だけ", "一人だけの", "唯一", "唯一の", "ただ一人", "ただ一人の", "たった一人", "たった一人の", "単独で", "自分だけ", "自分だけが"]
  static let soleMarkersEN: [(String, String)] = [
    (#"\bonly\b"#, "only"), (#"\bsole\b"#, "sole"), (#"\bsingle\b"#, "single"),
    (#"\bthe one who\b"#, "the one who"), (#"\bby myself\b"#, "by myself"), (#"\bon my own\b"#, "on my own"),
  ]
  static let soleRoleWords = ["担当", "リード", "リリース", "テスター", "検証", "品質", "デザイナー", "アナリスト",
                              "release", "lead", "tester", "qa", "designer", "analyst", "testing", "manager", "coordinator"]

  static let jaName = regex(#"(?:[゠-ヿ]|[一-鿿]){1,6}(?:さん|くん|ちゃん|様|氏)"#)
  static let jaDate = regex(#"\d{1,2}月\d{1,2}日|\d{1,2}/\d{1,2}"#)
  static let jaWeekdayParen = regex(#"\([月火水木金土日]\)"#)
  static let jaSoleSource = regex(#"(?:唯一の|一人だけの|ただ一人の|たった一人の|自分だけが|唯一|一人だけ|ただ一人|たった一人|自分だけ)(?:[のがとして、,\s]*)(?:[゠-ヿ一-鿿A-Za-z]+)*(?:担当|リード|リーダー|QA|テスター|検証|リリース|デザイナー|エンジニア|アナリスト|品質)[゠-ヿ一-鿿A-Za-z]*"#)
  static let enSoleSource = regex(#"\b(?:only|sole|single)\b(?:\s+[A-Za-z0-9_.'-]+){0,3}"#, .caseInsensitive)
  static let enName = regex(#"(?<![\p{L}\p{N}])([A-Z][a-z]{1,19})(?![\p{L}\p{N}])"#)
  static let enDate = regex(#"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b"#)

  // MARK: words and spans
  /// The one ordinary-word test (hasSpecificWord in domain.js).
  static func hasSpecificWord(_ term: String) -> Bool {
    let lower = term.lowercased()
    return matches(regex(#"[\p{L}\p{N}]+"#), in: lower).contains { !commonEnglishWords.contains(sub(lower, $0.range)) }
  }

  /// Boundaried, case-sensitive literal spans (literalSpans in domain.js).
  static func literalSpans(_ value: String, _ term: String) -> [NSRange] {
    if term.isEmpty { return [] }
    let re = regex(#"(?<![\p{L}\p{N}])"# + escape(term) + #"(?![\p{L}\p{N}])"#)
    return matches(re, in: value).map { $0.range }
  }

  static func pushRisk(_ found: inout [Risk], _ text: String, _ category: String) {
    if !text.isEmpty && len(text) <= 120 { found.append(Risk(text: text, category: category)) }
  }

  static func weekdayHits(_ raw: String) -> [Risk] {
    var hits: [Risk] = []
    var seen = Set<String>(), terms: [String] = []
    for (day, short) in weekdays {
      for t in [day, short].compactMap({ $0 }) where !seen.contains(t) { seen.insert(t); terms.append(t) }
    }
    // JS sort is stable: longest first, ties keep order.
    let ordered = terms.enumerated().sorted { a, b in
      len(a.element) != len(b.element) ? len(a.element) > len(b.element) : a.offset < b.offset
    }.map { $0.element }
    var seenStarts = Set<Int>()
    let n = ns(raw)
    for day in ordered {
      var from = 0
      while from < n.length {
        let r = n.range(of: day, options: [], range: NSRange(location: from, length: n.length - from))
        if r.location == NSNotFound { break }
        if !seenStarts.contains(r.location) {
          seenStarts.insert(r.location)
          hits.append(Risk(text: day, category: "weekday"))
        }
        from = r.location + 1
      }
    }
    for m in matches(jaWeekdayParen, in: raw) { pushRisk(&hits, sub(raw, m.range), "weekday") }
    return hits
  }

  static func englishSoleHits(_ raw: String) -> [Risk] {
    var hits: [Risk] = []
    for m in matches(enSoleSource, in: raw) {
      let chunk = sub(raw, m.range).trimmingCharacters(in: .whitespacesAndNewlines)
      let roleHit = soleRoleWords.contains { w in
        !hasJapanese(w) && test(regex(#"\b"# + escape(w) + #"\b"#, .caseInsensitive), chunk)
      }
      if roleHit { pushRisk(&hits, chunk, "uncommon role") }
    }
    return hits
  }

  static func keepLongestNameHits(_ m: [Risk]) -> [Risk] {
    let longest = m.enumerated().filter { (i, hit) in
      !m.enumerated().contains { (j, other) in j != i && includes(other.text, hit.text) }
    }.map { $0.element }
    return mergeRisks([longest])
  }

  /// Map semantics of mergeRisks: first-seen position, last value wins.
  static func mergeRisks(_ lists: [[Risk]]) -> [Risk] {
    var order: [String] = [], map: [String: Risk] = [:]
    for r in lists.flatMap({ $0 }) {
      if map[r.text] == nil { order.append(r.text) }
      map[r.text] = r
    }
    return order.map { map[$0]! }
  }

  static func dedupeNestedRisks(_ risks: [Risk]) -> [Risk] {
    risks.enumerated().filter { (i, r) in
      !risks.enumerated().contains { (j, o) in
        if j == i || o.category != r.category { return false }
        if r.category == "uncommon role" { return includes(r.text, o.text) && len(r.text) > len(o.text) }
        return includes(o.text, r.text) && len(o.text) > len(r.text)
      }
    }.map { $0.element }
  }

  /// Deterministic source-side marks (ruleBasedSourceRisks in domain.js).
  static func ruleBasedSourceRisks(_ raw: String) -> [Risk] {
    var found: [Risk] = []
    var names: [Risk] = matches(jaName, in: raw).map { Risk(text: sub(raw, $0.range), category: "name") }
    for m in matches(enName, in: raw) {
      let word = sub(raw, m.range(at: 1))
      if (!commonEnglishWords.contains(word.lowercased()) || test(enMonth, word)) && !weekdays.contains(where: { $0.0 == word }) {
        names.append(Risk(text: word, category: "name"))
      }
    }
    for hit in keepLongestNameHits(names) { pushRisk(&found, hit.text, hit.category) }
    for hit in weekdayHits(raw) { pushRisk(&found, hit.text, hit.category) }
    for m in matches(jaDate, in: raw) { pushRisk(&found, sub(raw, m.range), "date") }
    for m in matches(enDate, in: raw) { pushRisk(&found, sub(raw, m.range), "date") }
    for m in matches(jaSoleSource, in: raw) { pushRisk(&found, sub(raw, m.range), "uncommon role") }
    for hit in englishSoleHits(raw) { pushRisk(&found, hit.text, hit.category) }
    return Array(mergeRisks([found]).prefix(30))
  }

  /// Validate the AI candidates against the raw text (riskSpans in domain.js).
  static func riskSpans(_ raw: String, _ candidate: Any, ruleRisks: [Risk]) throws -> [Risk] {
    guard let arr = candidate as? [Any] else { throw DomainError("Invalid risk output") }
    let ruleTexts = Set(ruleRisks.map { $0.text })
    return arr.prefix(30).flatMap { item -> [Risk] in
      guard let d = item as? [String: Any], let term = d["text"] as? String, !term.isEmpty, includes(raw, term) else { return [] }
      let category = d["category"] as? String
      let specificWord = hasSpecificWord(term)
      let specificCategory = category.map { specificRiskCategories.contains($0) } ?? false
      var nameCandidate = false
      if specificWord && test(regex(#"^\p{Lu}\p{L}*$"#), term) {
        nameCandidate = literalSpans(raw, term).contains { span in
          let beforeAll = sub(raw, NSRange(location: 0, length: span.location))
          let before = beforeAll.replacingOccurrences(of: #"[\p{Ps}\p{Pi}"' \t]+$"#, with: "", options: .regularExpression)
          return len(before) > 0 && !test(regex(#"[.!?。！？\r\n]$"#), before)
        }
      }
      let keep = ruleTexts.contains(term) || test(regex(#"\p{N}"#), term) || test(enMonth, term)
        || !weekdayHits(term).isEmpty || nameCandidate || (specificCategory && specificWord)
      if !keep { return [] }
      return [Risk(text: term, category: specificCategory ? category! : "other identifying detail")]
    }
  }

  // MARK: residual check on the draft
  static func soleMarkerIn(_ t: String) -> Bool {
    for m in soleMarkersJA where includes(t, m) { return true }
    for (p, _) in soleMarkersEN where test(regex(p, .caseInsensitive), t) { return true }
    return false
  }

  static func termMatches(_ term: String, in text: String) -> Bool {
    hasJapanese(term) ? includes(text, term) : test(regex(#"\b"# + escape(term) + #"\b"#, .caseInsensitive), text)
  }

  static func roleTermsForSoleRisk(_ risk: Risk) -> [String] {
    var terms: [String] = []
    func add(_ t: String) { if !terms.contains(t) { terms.append(t) } }
    for w in soleRoleWords where termMatches(w, in: risk.text) { add(w) }
    if risk.category == "uncommon role" {
      for aliases in roleAliases where aliases.contains(where: { termMatches($0, in: risk.text) }) { aliases.forEach(add) }
    }
    return terms
  }

  static func termInDraft(_ draft: String, _ term: String) -> Bool {
    if hasJapanese(term) { return includes(draft, term) }
    return test(regex(#"(?<![\p{L}\p{N}])"# + escape(term) + #"(?![\p{L}\p{N}])"#, .caseInsensitive), draft)
  }

  static func termPattern(_ term: String) -> NSRegularExpression {
    hasJapanese(term)
      ? regex(escape(term), .caseInsensitive)
      : regex(#"(?<![\p{L}\p{N}])"# + escape(term) + #"(?![\p{L}\p{N}])"#, .caseInsensitive)
  }

  static func soleRoleResiduals(_ draft: String, _ risks: [Risk]) -> [Risk] {
    var found: [Risk] = []
    let solePattern = (soleMarkersJA.map(escape) + soleMarkersEN.map { $0.0 }).joined(separator: "|")
    for (i, risk) in risks.enumerated() {
      if risk.category != "uncommon role" || !soleMarkerIn(risk.text) { continue }
      let soleMatches = matches(regex(solePattern, .caseInsensitive), in: draft)
      if soleMatches.isEmpty { continue }
      let roles = roleTermsForSoleRisk(risk)
      if !roles.contains(where: { termInDraft(draft, $0) }) { continue }
      for m in soleMatches { found.append(Risk(text: sub(draft, m.range), category: "uncommon role", sourceRiskIndex: i)) }
      for term in roles where termInDraft(draft, term) {
        for m in matches(termPattern(term), in: draft) {
          found.append(Risk(text: sub(draft, m.range), category: "uncommon role", sourceRiskIndex: i))
        }
      }
    }
    return found
  }

  /// Fixed marks still present in the draft (residualRisks in domain.js). Any hit blocks approval.
  static func residualRisks(_ draft: String, _ risks: [Risk]) -> [Risk] {
    var found: [Risk] = []
    for (i, risk) in risks.enumerated() {
      var terms: [String] = [risk.text]
      func add(_ t: String) { if !terms.contains(t) { terms.append(t) } }
      if risk.category == "uncommon role" {
        for aliases in roleAliases where aliases.contains(where: { termMatches($0, in: risk.text) }) { aliases.forEach(add) }
      }
      if risk.category == "weekday" || risk.category == "date" {
        for (day, short) in weekdays where risk.text.lowercased().contains(day.lowercased()) || risk.text.contains(day) {
          add(day)
          if let s = short { add(s) }
        }
      }
      for term in terms {
        for m in matches(termPattern(term), in: draft) {
          found.append(Risk(text: sub(draft, m.range), category: risk.category, sourceRiskIndex: i))
        }
      }
    }
    return mergeRisks([found, soleRoleResiduals(draft, risks)])
  }

  // MARK: payload
  static func validatePayload(_ p: [String: String]) throws -> [String: String] {
    guard Set(p.keys) == ["approved_rewrite", "question_id"] else { throw DomainError("Unexpected response fields") }
    guard let q = p["question_id"], test(regex(#"^[a-zA-Z0-9_-]{1,100}$"#), q) else { throw DomainError("Invalid question ID") }
    return ["question_id": q, "approved_rewrite": try text(p["approved_rewrite"] ?? "")]
  }
}
