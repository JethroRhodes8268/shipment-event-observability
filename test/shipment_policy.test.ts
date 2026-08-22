import assert from "node:assert/strict";
import test from "node:test";
import { decideShipmentState, type ShipmentEvent } from "../src/shipment_policy.js";

const delivered: ShipmentEvent = {
  event_id: "evt_2026_08_17_001",
  shipment_id: "shp_4821",
  kind: "delivered",
  occurred_at: "2026-08-17T08:30:00.000Z",
};

test("a proof-required delivery stays in exception until its file is attached", () => {
  assert.deepEqual(decideShipmentState(delivered, true), {
    state: "exception",
    accepted: false,
    reason: "proof of delivery is required",
  });

  const withProof: ShipmentEvent = {
    ...delivered,
    proof_of_delivery: {
      object_key: "pod/shp_4821/evt_2026_08_17_001.pdf",
      sha256: "a".repeat(64),
      content_type: "application/pdf",
    },
  };
  assert.deepEqual(decideShipmentState(withProof, true), {
    state: "delivered",
    accepted: true,
    reason: "delivery recorded",
  });
});
