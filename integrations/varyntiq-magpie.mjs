function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function httpUrl(value, name) {
  const parsed = new URL(requiredString(value, name));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new TypeError(`${name} must be an HTTP(S) URL`);
  return parsed.toString();
}

function positiveInteger(value, name) {
  const raw = requiredString(String(value ?? ""), name);
  if (!/^\d+$/.test(raw)) throw new TypeError(`${name} must use base-10 integer units`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return parsed;
}

/**
 * Wraps a Magpie x402 request with a Varyntiq decision immediately before signing.
 * The signer is supplied by the caller and never receives or exposes its key here.
 */
export function createVaryntiqMagpieClient(options) {
  if (!options || typeof options !== "object") throw new TypeError("options are required");
  const token = requiredString(options.token, "token");
  const agentId = requiredString(options.agentId, "agentId");
  const baseUrl = httpUrl(options.baseUrl, "baseUrl").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 2500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new TypeError("timeoutMs must be between 100 and 30000");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const signPayment = options.signPayment;
  if (typeof signPayment !== "function") throw new TypeError("signPayment is required");

  async function checkBeforeSigning({ url, challenge, context = {} }) {
    const amount = positiveInteger(challenge.amountLamports, "challenge.amountLamports");
    const payTo = requiredString(challenge.payTo, "challenge.payTo");
    const nonce = requiredString(challenge.nonce, "challenge.nonce");
    const memo = requiredString(challenge.memo, "challenge.memo");
    const endpoint = httpUrl(url, "url");
    const intent = {
      intent_id: `magpie-${crypto.randomUUID()}`,
      agent_id: agentId,
      rail: "x402/solana/v1",
      amount_minor: amount,
      currency: "SOL",
      payee: payTo,
      endpoint,
      x402: { amount_lamports: String(amount), pay_to: payTo, nonce, memo, resource: { url: endpoint } },
      context: { integration: "magpie-x402-buyer", ...context },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/check`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(intent),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response?.ok) throw new Error("Varyntiq unavailable");
    const decision = await response.json();
    if (!decision || decision.intent_id !== intent.intent_id) throw new Error("Varyntiq receipt mismatch");
    options.onDecision?.(decision, intent);
    if (decision.decision !== "ALLOW") throw new Error(`Varyntiq: ${decision.decision ?? "invalid decision"}`);
    return decision;
  }

  return async function request(url, init = {}, context = {}) {
    const first = await fetchImpl(url, init);
    if (first.status !== 402) return first;
    const challenge = typeof options.parseChallenge === "function"
      ? await options.parseChallenge(first)
      : {
          amountLamports: first.headers.get("x-payment-required-amount"),
          payTo: first.headers.get("x-payment-required-recipient"),
          nonce: first.headers.get("x-payment-required-nonce"),
          memo: first.headers.get("x-payment-required-memo"),
        };
    await checkBeforeSigning({ url, challenge, context });
    const payment = await signPayment({ url, challenge });
    if (!payment || typeof payment.signature !== "string" || !payment.signature.trim()) throw new Error("signPayment must return a signature");
    const headers = new Headers(init.headers ?? {});
    headers.set("x-payment", payment.signature);
    return fetchImpl(url, { ...init, headers });
  };
}
