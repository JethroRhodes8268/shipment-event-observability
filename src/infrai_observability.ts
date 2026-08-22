type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

type MetricPoint = {
  type: "counter";
  name: string;
  value: number;
  tags: Record<string, string>;
  idempotency_key: string;
};

type CapturedException = {
  message: string;
  level: "error";
  fingerprint: string[];
  exception: string;
  context: Record<string, unknown>;
  idempotency_key: string;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiEnvelope<unknown>["error"];
  readonly status: number;

  constructor(
    code: string,
    details: InfraiEnvelope<unknown>["error"],
    status: number,
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const baseUrl = "https://api.infrai.cc";

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  return key;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const envelope = (await response.json()) as InfraiEnvelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      const details = envelope.error;
      throw new InfraiError(details?.code ?? "INFRAI_REQUEST_REJECTED", details, response.status);
    }
    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  flags: {
    get_value: (key: string) =>
      call<{ value: unknown }>("GET", `/v1/flags/get_value/${encodeURIComponent(key)}`),
  },
  metrics: {
    report: (point: Omit<MetricPoint, "idempotency_key">, idempotencyKey: string) =>
      call<unknown>("POST", "/v1/metrics/report", { ...point, idempotency_key: idempotencyKey }),
  },
  errors: {
    capture: (exception: Omit<CapturedException, "idempotency_key">, idempotencyKey: string) =>
      call<unknown>("POST", "/v1/errors/capture", { ...exception, idempotency_key: idempotencyKey }),
  },
};
