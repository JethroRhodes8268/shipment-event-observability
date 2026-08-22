export type ShipmentEventKind = "picked_up" | "in_transit" | "delivered" | "delivery_failed";

export type ProofOfDelivery = {
  object_key: string;
  sha256: string;
  content_type: "image/jpeg" | "image/png" | "application/pdf";
};

export type ShipmentEvent = {
  event_id: string;
  shipment_id: string;
  kind: ShipmentEventKind;
  occurred_at: string;
  proof_of_delivery?: ProofOfDelivery;
  exception_note?: string;
};

export type ShipmentDecision = {
  state: "in_progress" | "delivered" | "exception";
  accepted: boolean;
  reason: string;
};

export function decideShipmentState(event: ShipmentEvent, requireProof: boolean): ShipmentDecision {
  if (event.kind === "delivery_failed") {
    return { state: "exception", accepted: true, reason: event.exception_note ?? "delivery failed" };
  }
  if (event.kind === "delivered" && requireProof && !event.proof_of_delivery) {
    return { state: "exception", accepted: false, reason: "proof of delivery is required" };
  }
  if (event.kind === "delivered") {
    return { state: "delivered", accepted: true, reason: "delivery recorded" };
  }
  return { state: "in_progress", accepted: true, reason: `${event.kind} recorded` };
}
