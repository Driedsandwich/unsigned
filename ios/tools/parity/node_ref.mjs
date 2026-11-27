// Reference output from src/domain.js, same shape as main.swift.
import { readFileSync } from 'node:fs';
import { ruleBasedSourceRisks, riskSpans, mergeRisks, dedupeNestedRisks, residualRisks } from '../../../src/domain.js';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pick = r => ({ text: r.text, category: r.category });
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const out = cases.map(c => {
  const rule = ruleBasedSourceRisks(c.raw);
  const spans = riskSpans(c.raw, c.ai, rule);
  const merged = dedupeNestedRisks(mergeRisks(spans, rule));
  return { id: c.id, rule: rule.map(pick), spans: spans.map(pick), merged: merged.map(pick), residuals: c.drafts.map(d => residualRisks(d, merged).map(pick)) };
});
console.log(JSON.stringify(sortKeys(out)));
