export type DebugEventCategory =
  | 'traffic'
  | 'session-update'
  | 'prompt'
  | 'client-request'
  | 'client-response'
  | 'client-error'
  | 'lifecycle';

export type DebugEventDirection = 'send' | 'recv';

export interface DebugEventInput {
  category: DebugEventCategory;
  direction?: DebugEventDirection;
  agentId?: string;
  sessionId?: string;
  method?: string;
  status?: string;
  durationMs?: number;
  payload?: unknown;
}

export interface DebugEvent extends DebugEventInput {
  id: number;
  timestamp: string;
  payloadSizeBytes: number;
}

export interface DebugTraceSnapshot {
  version: 1;
  startedAt: string;
  capturedAt: string;
  events: DebugEvent[];
  eventCount: number;
  droppedEvents: number;
  maxEvents: number;
  maxBytes: number;
  totalBytes: number;
}

export interface DebugTraceStoreOptions {
  maxEvents?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function cloneForJson(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }
  if (valueType === 'bigint') {
    return `${value.toString()}n`;
  }
  if (valueType === 'symbol' || valueType === 'function') {
    return String(value);
  }

  if (value instanceof Error) {
    const errorPayload: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    for (const key of Object.keys(value)) {
      errorPayload[key] = cloneForJson((value as unknown as Record<string, unknown>)[key], seen);
    }
    return errorPayload;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return {
      type: value.constructor.name,
      byteLength: value.byteLength,
      base64: Buffer.from(value).toString('base64'),
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      byteLength: value.byteLength,
      base64: Buffer.from(value).toString('base64'),
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const cloned = value.map(item => cloneForJson(item, seen));
    seen.delete(value);
    return cloned;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      return '[Circular]';
    }
    seen.add(record);
    const cloned: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(record)) {
      cloned[key] = cloneForJson(nestedValue, seen);
    }
    seen.delete(record);
    return cloned;
  }

  return String(value);
}

function serializePayload(value: unknown): { payload: unknown; sizeBytes: number } {
  const payload = cloneForJson(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (e) {
    const fallback = cloneForJson(e);
    serialized = JSON.stringify(fallback);
    return {
      payload: {
        serializationError: fallback,
        stringValue: String(value),
      },
      sizeBytes: byteLength(serialized),
    };
  }

  return {
    payload,
    sizeBytes: byteLength(serialized ?? ''),
  };
}

export class DebugTraceStore {
  private readonly startedAt = new Date().toISOString();
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private events: DebugEvent[] = [];
  private nextId = 1;
  private droppedEvents = 0;
  private totalBytes = 0;

  constructor(options: DebugTraceStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  record(input: DebugEventInput): DebugEvent {
    const serialized = serializePayload(input.payload);
    const event: DebugEvent = {
      ...input,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      payload: serialized.payload,
      payloadSizeBytes: serialized.sizeBytes,
    };

    this.events.push(event);
    this.totalBytes += event.payloadSizeBytes;
    this.enforceCaps();
    return cloneForJson(event) as DebugEvent;
  }

  snapshot(): DebugTraceSnapshot {
    return {
      version: 1,
      startedAt: this.startedAt,
      capturedAt: new Date().toISOString(),
      events: this.events.map(event => cloneForJson(event) as DebugEvent),
      eventCount: this.events.length,
      droppedEvents: this.droppedEvents,
      maxEvents: this.maxEvents,
      maxBytes: this.maxBytes,
      totalBytes: this.totalBytes,
    };
  }

  clear(): void {
    this.events = [];
    this.totalBytes = 0;
    this.droppedEvents = 0;
  }

  private enforceCaps(): void {
    while (this.events.length > this.maxEvents) {
      this.dropOldest();
    }

    while (this.events.length > 1 && this.totalBytes > this.maxBytes) {
      this.dropOldest();
    }
  }

  private dropOldest(): void {
    const dropped = this.events.shift();
    if (!dropped) {
      return;
    }
    this.totalBytes = Math.max(0, this.totalBytes - dropped.payloadSizeBytes);
    this.droppedEvents += 1;
  }
}
