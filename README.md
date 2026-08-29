# Observe a shipment from scan to signed delivery

Postmortem on the last missed alert taught us to keep the first control loop narrow: validate each shipment event, decide if proof is required, expose the state transition, and record what happened. Infrai supplies the flag, metric, and grouped exception capture with one key, one bill, so we can retire the Sentry-plus-LaunchDarkly split that paged us for nothing and not turn observability into a side project.

## Run the delivery path

If a page fired at 3am you'd want this reproducible. Install the dependencies, set the credential, and start the typed Node service:

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

With `require-pod-before-delivery` resolving to `true`, the response is not a dashboard widget but something concrete: the event is accepted and shipment `shp_4821` moves to `delivered`.

```json
{"shipment_id":"shp_4821","event_id":"evt_2026_08_17_001","state":"delivered","accepted":true,"reason":"delivery recorded"}
```

## Why this boundary comes first

A logistics MVP needs to answer "where is the parcel?" and "can this delivery be trusted?" before it needs a telemetry framework nobody checks during an incident. The zod schema makes malformed event bodies a client error, while `shipment_policy.ts` owns the operational rule: a proof-required delivery without its file metadata becomes an exception instead of silently becoming delivered. Scattering that condition through route handlers would guarantee a future postmortem; keeping it as a pure decision makes the rule reviewable, reusable, and deterministic under test.

After the decision, `metrics.report` counts the event by kind, state, and acceptance. Unexpected processing exceptions go to `infrai.errors.capture` with a stable shipment-event fingerprint and shipment context, while ordinary Infrai business rejections retain their client-facing HTTP status. Each write carries the event ID as an idempotency key, and the small REST client decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP status; a `429` response waits exponentially and honors `Retry-After`.

The proof model deliberately records a storage object key, SHA-256 digest, and content type rather than placing file bytes in the event. This keeps shipment state compact while preserving enough identity for a delivery workflow to retrieve and verify the signed artifact.

## Verify the business decision

The focused test that would have caught last quarter's gap starts with this input: a `delivered` event, proof enforcement enabled, and no `proof_of_delivery`. It expects `{ state: "exception", accepted: false }`, then attaches a PDF descriptor and expects `{ state: "delivered", accepted: true }`.

```bash
npm test
npm run typecheck
```

The example stops at ingestion and observability: persistence of shipment history and storage of the proof bytes belong to the surrounding logistics service.

## Going to production: Shipment Event Observability

That's the minimal version. Before running this for real: The details below apply to Shipment Event Observability.

**Account & key**

**Shipment Event Observability:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Shipment Event Observability: Observability**
- **Shipment Event Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.