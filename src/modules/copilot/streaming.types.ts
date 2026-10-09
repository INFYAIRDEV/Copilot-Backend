import { z } from "zod";

/**
 * Application-owned Copilot Streaming Event Types.
 * Matches the OpenAPI 3.1 contract.
 */
export const STREAM_EVENT_TYPES = {
  RESPONSE_STARTED: "response_started",
  CONTENT_CHUNK: "content_chunk",
  RESULT_AVAILABLE: "result_available",
  DEGRADED_RESPONSE: "degraded_response",
  RESPONSE_COMPLETED: "response_completed",
  ERROR: "error",
} as const;

export type StreamEventType =
  (typeof STREAM_EVENT_TYPES)[keyof typeof STREAM_EVENT_TYPES];

export interface StreamResponseStartedData {
  conversation_uuid: string;
  request_uuid: string;
  created_at: string;
}

export interface StreamContentChunkData {
  delta: string;
  index: number;
}

export interface StreamResultAvailableData {
  plan_id: string;
  confidence_score: number;
  suggested_visualization?: string;
  primary_entity?: string;
}

export interface StreamDegradedResponseData {
  reason: string;
}

export interface StreamResponseCompletedData {
  message_id: number;
  role: "ASSISTANT";
  kind: string;
  text: string;
  conversation_uuid: string;
  created_at: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    latency_ms: number;
  };
}

export interface StreamErrorData {
  code: string;
  message: string;
  status_code: number;
}

/**
 * Interface for emitting application-owned SSE stream events.
 */
export interface ChatStreamEmitter {
  emitStart(data: StreamResponseStartedData): void;
  emitChunk(data: StreamContentChunkData): void;
  emitResult(data: StreamResultAvailableData): void;
  emitDegraded(data: StreamDegradedResponseData): void;
  emitComplete(data: StreamResponseCompletedData): void;
  emitError(data: StreamErrorData): void;
  isAborted(): boolean;
  abort(): void;
}

/**
 * Formats an event name and data object into standard SSE wire format.
 */
export function formatSseEvent(
  event: StreamEventType | string,
  data: any,
): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Patterns of sensitive data that must never be streamed to the client.
 */
export const STREAM_SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /sk-[a-zA-Z0-9]{20,}/gi,
  /secret\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /postgres:\/\/[^'"\s]+/gi,
  /mysql:\/\/[^'"\s]+/gi,
  /\bSELECT\s+[\s\S]+?\s+FROM\s+[\s\S]+?(?:;|$)/gi,
  /\b(?:INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|DROP\s+TABLE)\s+[\s\S]+?(?:;|$)/gi,
];

/**
 * Sanitizes chunk text before emitting it to the client.
 */
export function sanitizeStreamChunk(chunk: string): string {
  if (!chunk || typeof chunk !== "string") return "";
  let sanitized = chunk;
  for (const pattern of STREAM_SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}
