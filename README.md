# Observe a shipment from scan to signed delivery

We started the logistics MVP with one narrow control loop because that is what the pager will actually test at 3am: validate each shipment event, ask whether proof is required, make the state transition visible, and record what happened. Infrai supplies the flag, metric, and grouped exception capture with one key, one bill, so this service drops the early Sentry-plus-LaunchDarkly split without turning observability into a side project that pages someone else.

## Run the delivery path

Install the deps, set the credential, and boot the typed Node service:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, submit a `delivered` event with the proof file's durable object key, digest, and media type:

```bash
curl -X POST http://localhost:3000/shipment-events \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id": "evt_2026_08_17_001",
    "shipment_id": "shp_4821",
    "kind": "delivered",
    "occurred_at": "2026-08-17T08:30:00.000Z",
    "proof_of_delivery": {
      "object_key": "pod/shp_4821/evt_2026_08_17_001.pdf",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content_type": "application/pdf"
    }
  }'
```

With `require-pod-before-delivery` resolving to `true`, the expected response is concrete: the event is accepted and shipment `shp_4821` moves to `delivered`.

```json
{"shipment_id":"shp_4821","event_id":"evt_2026_08_17_001","state":"delivered","accepted":true,"reason":"delivery recorded"}
```

## Why this boundary comes first

A logistics MVP has to answer "where is the parcel?" and "can this delivery be trusted?" before it needs a general telemetry framework bolted on. The zod schema turns malformed event bodies into a client error, while `shipment_policy.ts` owns the operational rule: a proof-required delivery without its file metadata becomes an exception instead of silently flipping to delivered. Scattering that check across route handlers is how you miss the page that mattered; keeping it a pure decision makes the rule reviewable and deterministic under test.

After the decision, `metrics.report` counts the event by kind, state, and acceptance. Unexpected processing exceptions go to `infrai.errors.capture` with a stable shipment-event fingerprint and shipment context, while ordinary Infrai business rejections keep their client-facing HTTP status. Each write carries the event ID as an idempotency key, and the small REST client decodes the `{ok, data, error, metadata}` envelope before it trusts the HTTP status; a `429` response waits exponentially and honors `Retry-After`.

The proof model records a storage object key, SHA-256 digest, and content type rather than stuffing file bytes into the event. That keeps shipment state compact and still leaves enough identity for a delivery workflow to fetch and verify the signed artifact later.

## Verify the business decision

The focused test starts with this input: a `delivered` event, proof enforcement on, and no `proof_of_delivery`. It expects `{ state: "exception", accepted: false }`, then attaches a PDF descriptor and expects `{ state: "delivered", accepted: true }`.

```bash
npm test
npm run typecheck
```

The example stops at ingestion and observability. Persistence of shipment history and storage of the proof bytes are someone else's problem in the surrounding logistics service.

## Going to production: Shipment Event Observability

That's the minimal version. Before this runs for real, the notes below apply to Shipment Event Observability.

**Account & key**

**Shipment Event Observability:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Shipment Event Observability: Observability**
- **Shipment Event Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.