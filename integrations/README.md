# Varyntiq adapter for Magpie x402

This independent adapter addresses Magpie's public request for an SDK wrapper around its x402 payment-and-retry flow. It checks the payment challenge with Varyntiq immediately before the caller's signer runs, then retries the same request with the returned signature.

The adapter never receives private keys, signs transactions, or settles funds. The `signPayment` callback remains owned by the integrating agent.

Pass the Varyntiq service URL explicitly as `baseUrl`; the adapter has no baked-in deployment or brand-specific endpoint. Keep the Varyntiq token in the host environment and pass it as `token`.

The tests cover an allowed payment, a blocked payment that never reaches the signer, and fail-closed behavior when Varyntiq is unavailable.

This is a local, non-production contribution prepared for review. It is not an official Magpie integration and has not been sent upstream.
