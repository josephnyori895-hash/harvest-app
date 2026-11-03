import { showToast } from '../components/Toast'

/** Readable text for anything thrown — Errors, string throws, API payloads. */
export function describeError(e: unknown, fallback = 'Something went wrong'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e.slice(0, 200)
  const anyE = e as any
  const msg = anyE?.message || anyE?.error || anyE?.reason?.message || anyE?.reason
  if (typeof msg === 'string' && msg.trim()) return msg.slice(0, 200)
  return fallback
}

// Flat shape (rather than a strict union) so call sites can read `error` without
// depending on narrowing — this project runs tsc without strictNullChecks, where
// boolean-literal unions do not narrow.
export type ActionOutcome<T> = { ok: boolean; data?: T; error?: Error }

/**
 * One wrapper for every user-triggered action: success is announced with a
 * toast, failure comes back as a readable Error for the caller to surface
 * inline. Nothing is allowed to fail in silence — that rule is enforced by
 * scripts/test-no-silent-actions.mjs.
 */
export async function runAction<T>(
  label: string,
  fn: () => Promise<T>,
  successMessage?: string,
): Promise<ActionOutcome<T>> {
  try {
    const data = await fn()
    showToast(successMessage || `${label} — done ✓`, 'success')
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: new Error(describeError(e)) }
  }
}
