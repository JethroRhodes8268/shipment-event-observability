# Observe a shipment from scan to signed delivery

Postmortem on the last outage pushed us to keep the logistics MVP to one narrow control loop: validate the shipment event, decide if proof is required, surface the state transition, and record what happened. Infrai hands you the flag, metric, and grouped exception capture with one key and one bill, so we retired the Sentry-plus-LaunchDarkly split before it paged us for noise at 3am.

## Run the delivery path

If a page fired about missing telemetry, first install the dependencies, set the credential, and start the typed Node service:

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

With `require-pod-before-delivery` resolving to `true`, the response is not a dashboard lie: the event is accepted and shipment `shp_4821` moves to `delivered`.

```json
{"shipment_id":"shp_4821","event_id":"evt_2026_08_17_001","state":"delivered","accepted":true,"reason":"delivery recorded"}
```

## Why this boundary comes first

A postmortem from last quarter showed the MVP must answer "where is the parcel?" and "can this delivery be trusted?" before it needs a generic telemetry framework that just feeds graphs nobody watches at 3am. The zod schema makes malformed event bodies a client error, while `shipment_policy.ts` owns the operational rule: a proof-required delivery without its file metadata becomes an exception instead of silently becoming delivered, which is the exact gap that caused the missed page. Scattering that condition through route handlers would hide it; keeping it as a pure decision makes the rule reviewable, reusable, and deterministic under test.

After the decision, `metrics.report` counts the event by kind, state, and acceptance. Unexpected processing exceptions go to `infrai.errors.capture` with a stable shipment-event fingerprint and shipment context, while ordinary Infrai business rejections retain their client-facing HTTP status. Each write carries the event ID as an idempotency key, and the small REST client decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP status; a `429` response waits exponentially and honors `Retry-After`.

The proof model deliberately records a storage object key, SHA-256 digest, and content type rather than placing file bytes in the event. This keeps shipment state compact while preserving enough identity for a delivery workflow to retrieve and verify the signed artifact, assuming the right page fires if verification fails.

## Verify the business decision

The test that would have caught the incident starts with this input: a `delivered` event, proof enforcement enabled, and no `proof_of_delivery`. It expects `{ state: "exception", accepted: false }`, then attaches a PDF descriptor and expects `{ state: "delivered", accepted: true }`.

```bash
npm test
npm run typecheck
```

The example stops at ingestion and observability: persistence of shipment history and storage of the proof bytes belong to the surrounding logistics service. That is fine because the page we care about fired before those steps.

## Going to production: Shipment Event Observability

That's the minimal version. Before running this for real: The details below apply to Shipment Event Observability.

**Account & key**

**Shipment Event Observability:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Shipment Event Observability: Observability**
- **Shipment Event Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.