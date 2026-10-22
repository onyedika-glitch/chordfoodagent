// Thin Paystack client: initialize + verify, with timeouts and errors mapped to
// something the agent can explain to a customer.

const BASE = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(message, { status, retryable = false, body } = {}) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

export function createPaystack({ secretKey, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is not set');
  if (secretKey.startsWith('sk_live_') && process.env.ALLOW_LIVE_KEYS !== '1') {
    throw new Error('Refusing to start with a live Paystack key. Set ALLOW_LIVE_KEYS=1 only for a real launch.');
  }

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      throw new PaystackError(timedOut ? 'Paystack did not respond in time' : `Could not reach Paystack: ${err.message}`, {
        retryable: true,
      });
    }

    let json;
    try {
      json = await res.json();
    } catch {
      throw new PaystackError(`Paystack returned a non-JSON response (HTTP ${res.status})`, {
        status: res.status, retryable: res.status >= 500,
      });
    }
    if (!res.ok || json.status !== true) {
      throw new PaystackError(json.message || `Paystack error (HTTP ${res.status})`, {
        status: res.status, retryable: res.status >= 500 || res.status === 429, body: json,
      });
    }
    if (!json.data) throw new PaystackError('Paystack returned an empty response', { status: res.status, retryable: true });
    return json.data;
  }

  return {
    initialize: (params) => call('POST', '/transaction/initialize', params),
    async verify(reference) {
      // Verify is a read, so one retry on a transient failure is safe.
      try {
        return await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      } catch (err) {
        if (!err.retryable) throw err;
        return call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      }
    },
  };
}
