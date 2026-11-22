// Includes lazy loading, queue wait, first-call preparation (~11s in the supplied
// spike), and inference. SDK RequestOptions.timeout only covers cloud HTTP.
export const PRIVATE_CALL_TIMEOUT_MS = 60_000;

export async function privateCall(infer, feature, token, options, timeoutMs = PRIVATE_CALL_TIMEOUT_MS) {
  let active = true, timer;
  const current = () => active && options.current();
  try {
    return await Promise.race([
      infer(feature, token, { ...options, current,
        onPartial: options.onPartial ? (...args) => { if (current()) options.onPartial(...args); } : undefined
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new DOMException('Private call deadline exceeded', 'TimeoutError')), timeoutMs); })
    ]);
  } finally {
    active = false; clearTimeout(timer);
    // A timed-out SDK operation still owns its queue slot until it settles.
    // Its late output is ignored; another device call cannot run over it.
  }
}

export function privateFailure(stage, error) {
  const kind = error?.name === 'TimeoutError' || /timeout|timed[ -]?out|deadline/i.test(String(error?.code ?? '') + ' ' + String(error?.message ?? '')) ? 'timeout' : 'error';
  const detail = `${stage}: ${kind}`;
  // Never log the exception, prompt, draft, or model response.
  console.warn(`[Unsigned] ${detail}`);
  return detail;
}
