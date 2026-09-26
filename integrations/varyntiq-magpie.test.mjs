import assert from "node:assert/strict";
import test from "node:test";
import { createVaryntiqMagpieClient } from "./varyntiq-magpie.mjs";

const url = "https://x402.magpie.capital/api/v1/credit-score?wallet=wallet-1";
const challenge = {
  amountLamports: "1000000",
  payTo: "MagpieTreasury1111111111111111111111111111111",
  nonce: "nonce-1",
  memo: "magpie-x402:nonce-1",
};

function clientWith(decision, calls = []) {
  return createVaryntiqMagpieClient({
    token: "test-token",
    agentId: "demo-agent",
    fetchImpl: async (requestUrl, init = {}) => {
      calls.push({ requestUrl, init });
      if (requestUrl.endsWith("/check")) {
        const body = JSON.parse(init.body);
        return { ok: true, async json() { return { intent_id: body.intent_id, decision, receipt_id: "receipt-1" }; } };
      }
      if (!init.headers?.get?.("x-payment")) {
        return { status: 402, headers: new Headers({
          "x-payment-required-amount": challenge.amountLamports,
          "x-payment-required-recipient": challenge.payTo,
          "x-payment-required-nonce": challenge.nonce,
          "x-payment-required-memo": challenge.memo,
        }) };
      }
      return { status: 200, ok: true, headers: new Headers() };
    },
    signPayment: async () => ({ signature: "solana-signature-1" }),
  });
}

test("checks Varyntiq before signing and retries Magpie with the payment signature", async () => {
  const calls = [];
  const client = clientWith("ALLOW", calls);
  const response = await client(url, { method: "GET" }, { purpose: "credit-score lookup" });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[1].init.body, /magpie-x402-buyer/);
  assert.equal(calls[2].init.headers.get("x-payment"), "solana-signature-1");
});

test("blocks before the signer on DENY", async () => {
  let signed = false;
  const client = createVaryntiqMagpieClient({
    token: "test-token", agentId: "demo-agent",
    fetchImpl: async (requestUrl, init = {}) => {
      if (requestUrl.endsWith("/check")) {
        const body = JSON.parse(init.body);
        return { ok: true, async json() { return { intent_id: body.intent_id, decision: "BLOCK" }; } };
      }
      return { status: 402, headers: new Headers({
        "x-payment-required-amount": challenge.amountLamports,
        "x-payment-required-recipient": challenge.payTo,
        "x-payment-required-nonce": challenge.nonce,
        "x-payment-required-memo": challenge.memo,
      }) };
    },
    signPayment: async () => { signed = true; return { signature: "should-not-exist" }; },
  });
  await assert.rejects(() => client(url), /Varyntiq: BLOCK/);
  assert.equal(signed, false);
});

test("fails closed when the policy service is unavailable", async () => {
  const client = createVaryntiqMagpieClient({
    token: "test-token", agentId: "demo-agent",
    fetchImpl: async (requestUrl) => {
      if (requestUrl.endsWith("/check")) throw new Error("offline");
      return { status: 402, headers: new Headers({
        "x-payment-required-amount": challenge.amountLamports,
        "x-payment-required-recipient": challenge.payTo,
        "x-payment-required-nonce": challenge.nonce,
        "x-payment-required-memo": challenge.memo,
      }) };
    },
    signPayment: async () => ({ signature: "should-not-exist" }),
  });
  await assert.rejects(() => client(url), /offline/);
});
