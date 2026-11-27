// Runs Domain.swift on cases.json and prints JSON. Compare with node_ref.mjs (see ../parity.sh).
import Foundation

func rj(_ r: [Risk]) -> [[String: String]] { r.map { ["text": $0.text, "category": $0.category] } }
let path = CommandLine.arguments[1]
let cases = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [[String: Any]]
var out: [[String: Any]] = []
for c in cases {
  let raw = c["raw"] as! String, ai = c["ai"]!, drafts = c["drafts"] as! [String]
  let rule = Domain.ruleBasedSourceRisks(raw)
  let spans = try! Domain.riskSpans(raw, ai, ruleRisks: rule)
  let merged = Domain.dedupeNestedRisks(Domain.mergeRisks([spans, rule]))
  var residuals: [[[String: String]]] = []
  for d in drafts { residuals.append(rj(Domain.residualRisks(d, merged))) }
  out.append(["id": c["id"]!, "rule": rj(rule), "spans": rj(spans), "merged": rj(merged), "residuals": residuals])
}
let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes])
print(String(data: data, encoding: .utf8)!)
