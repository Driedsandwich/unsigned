// The single executable feature policy. README's table is generated from this object.
export const POLICY = Object.freeze({
  rewrite: Object.freeze({ input: 'raw', mode: 'ONLY_ON_DEVICE' }),
  identifyRisks: Object.freeze({ input: 'raw', mode: 'ONLY_ON_DEVICE' }),
  groupThemes: Object.freeze({ input: 'approved_batch', mode: 'ONLY_IN_CLOUD' }),
  draftQuestion: Object.freeze({ input: 'admin_request', mode: 'PREFER_ON_DEVICE' })
});
export function assertPolicy(policy = POLICY) {
  for (const [feature, rule] of Object.entries(policy)) {
    if (rule.input === 'raw' && rule.mode !== 'ONLY_ON_DEVICE') throw new Error('Raw input must stay on device');
    if (!POLICY[feature] || POLICY[feature].input !== rule.input || POLICY[feature].mode !== rule.mode) throw new Error('Invalid feature policy');
  }
  if (Object.keys(policy).length !== Object.keys(POLICY).length) throw new Error('Incomplete policy');
}
assertPolicy();
