// Fetch helper: honours HTTPS_PROXY (Node's built-in fetch ignores it) and retries.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 3, timeoutMs = 180_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      // 429/5xx are worth retrying, other statuses are not.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 300)}`);
      }
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message.startsWith('HTTP 4')) throw err;
    }
    const wait = 2000 * 2 ** attempt;
    console.warn(`  request failed (${String((lastErr as Error)?.message ?? lastErr)}), retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}
