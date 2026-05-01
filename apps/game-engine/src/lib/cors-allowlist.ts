/**
 * Parse and validate the CORS origin allowlist from WEB_ORIGIN env var.
 * Comma-separated, scheme required, wildcard refused.
 */
export function parseCorsAllowlist(raw: string): string[] {
  if (!raw.trim()) throw new Error('WEB_ORIGIN is empty');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === '*') throw new Error('CORS wildcard not allowed; list explicit origins');
    if (!/^https?:\/\//.test(p)) throw new Error(`CORS origin must start with http(s):// — got "${p}"`);
    out.push(p.replace(/\/$/, ''));
  }
  return out;
}
