import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { infrai, InfraiError } from "./infrai_observability.js";
import { decideShipmentState, type ShipmentEvent } from "./shipment_policy.js";

const shipmentEventBody = z.object({
  event_id: z.string().min(1),
  shipment_id: z.string().min(1),
  kind: z.enum(["picked_up", "in_transit", "delivered", "delivery_failed"]),
  occurred_at: z.string().datetime(),
  proof_of_delivery: z.object({
    object_key: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content_type: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  }).optional(),
  exception_note: z.string().min(1).optional(),
}).strict();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function processShipmentEvent(event: ShipmentEvent) {
  const requireProof = event.kind === "delivered" && !event.proof_of_delivery
    ? (await infrai.flags.get_value("require-pod-before-delivery")).value === true
    : false;
  const decision = decideShipmentState(event, requireProof);

  await infrai.metrics.report({
    type: "counter",
    name: "shipment.events",
    value: 1,
    tags: { kind: event.kind, state: decision.state, accepted: String(decision.accepted) },
  }, `shipment-metric:${event.event_id}`);

  return { shipment_id: event.shipment_id, event_id: event.event_id, ...decision };
}

export async function handleShipmentRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST" || request.url !== "/shipment-events") {
    send(response, 404, { error: "route not found" });
    return;
  }

  let event: ShipmentEvent | undefined;
  try {
    event = shipmentEventBody.parse(await readJson(request)) as ShipmentEvent;
    const result = await processShipmentEvent(event);
    send(response, result.accepted ? 202 : 409, result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "invalid shipment event" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }

    const exception = error instanceof Error ? error : new Error("Unexpected shipment processing error");
    if (event) {
      await infrai.errors.capture({
        message: exception.message,
        level: "error",
        fingerprint: ["shipment-event", event.kind],
        exception: exception.stack ?? exception.message,
        context: { shipment_id: event.shipment_id, event_id: event.event_id, kind: event.kind },
      }, `shipment-error:${event.event_id}`);
    }
    send(response, 500, { error: "shipment processing failed" });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createServer((request, response) => {
    void handleShipmentRequest(request, response);
  }).listen(port, () => console.log(`Shipment event service listening on http://localhost:${port}`));
}
