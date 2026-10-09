import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { CopilotError } from "./copilot.error.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const CURSOR_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cursorSecret = () =>
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;

export interface MessageCursorData {
  v: 1;
  res?: "msg_history";
  uid: number;
  cid: number;
  limit: number;
  created_at: string;
  mid: number;
  filter_hash?: string | null;
  scope_hash?: string | null;
  dir?: "forward" | "backward";
  exp: number;
}

export interface ConversationCursorData {
  v: 1;
  res?: "conv_list";
  t?: "conv_list";
  uid: number;
  limit: number;
  created_at: string;
  cid: number;
  filter_hash?: string | null;
  scope_hash?: string | null;
  dir?: "forward" | "backward";
  exp: number;
}

export function computeFilterHash(
  filters?: Record<string, any> | null,
): string | null {
  if (!filters || Object.keys(filters).length === 0) return null;
  const sorted = Object.keys(filters)
    .sort()
    .reduce(
      (acc, key) => {
        if (
          filters[key] !== undefined &&
          filters[key] !== null &&
          key !== "cursor" &&
          key !== "limit"
        ) {
          acc[key] = filters[key];
        }
        return acc;
      },
      {} as Record<string, any>,
    );
  if (Object.keys(sorted).length === 0) return null;
  return createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 16);
}

export class PaginationService {
  constructor(
    private readonly getSecret: () => string | undefined = cursorSecret,
  ) {}

  encodeMessageCursor(params: {
    userId: number;
    conversationId: number;
    limit: number;
    createdAt: Date;
    messageId: number;
    filterHash?: string | null;
    scopeHash?: string | null;
    ttlMs?: number;
  }): string {
    const secret = this.getSecret();
    if (!secret) {
      throw new CopilotError(
        500,
        "INTERNAL_ERROR",
        "Service configuration error",
      );
    }
    const data: MessageCursorData = {
      v: 1,
      res: "msg_history",
      uid: params.userId,
      cid: params.conversationId,
      limit: params.limit,
      created_at: params.createdAt.toISOString(),
      mid: params.messageId,
      filter_hash: params.filterHash ?? null,
      scope_hash: params.scopeHash ?? null,
      dir: "forward",
      exp: Date.now() + (params.ttlMs ?? CURSOR_TTL_MS),
    };
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  decodeMessageCursor(
    cursor: string,
    context: {
      userId: number;
      conversationId: number;
      limit: number;
      filterHash?: string | null;
      scopeHash?: string | null;
    },
  ): { created_at: Date; id: number } {
    const secret = this.getSecret();
    if (!cursor || typeof cursor !== "string") {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor format");
    }
    const parts = cursor.split(".");
    if (parts.length !== 2 || !secret) {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor format");
    }
    const [payload, signature] = parts;
    const expected = createHmac("sha256", secret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor signature");
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new CopilotError(
        400,
        "INVALID_CURSOR",
        "Invalid or tampered cursor signature",
      );
    }

    try {
      const data = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as MessageCursorData;
      if (data.v !== 1) {
        throw new Error("Unsupported cursor version");
      }
      if (data.res && data.res !== "msg_history") {
        throw new Error("Incompatible cursor resource type");
      }
      if (data.uid !== context.userId) {
        throw new Error("Cursor belongs to another user");
      }
      if (data.cid !== context.conversationId) {
        throw new Error("Cursor belongs to another conversation");
      }
      if (data.limit !== context.limit) {
        throw new Error("Cursor limit does not match request limit");
      }
      if (data.exp < Date.now()) {
        throw new Error("Cursor has expired");
      }
      if (
        data.filter_hash &&
        context.filterHash &&
        data.filter_hash !== context.filterHash
      ) {
        throw new Error("Query filters do not match cursor context");
      }
      if (
        data.scope_hash &&
        context.scopeHash &&
        data.scope_hash !== context.scopeHash
      ) {
        throw new Error("Authorization scope does not match cursor context");
      }
      if (
        !Number.isSafeInteger(data.mid) ||
        Number.isNaN(Date.parse(data.created_at))
      ) {
        throw new Error("Invalid cursor position data");
      }
      return { created_at: new Date(data.created_at), id: data.mid };
    } catch (err: any) {
      throw new CopilotError(
        400,
        "INVALID_CURSOR",
        "Invalid or expired cursor",
      );
    }
  }

  encodeConversationCursor(params: {
    userId: number;
    conversationId: number;
    limit: number;
    createdAt: Date;
    filterHash?: string | null;
    scopeHash?: string | null;
    ttlMs?: number;
  }): string {
    const secret = this.getSecret();
    if (!secret) {
      throw new CopilotError(
        500,
        "INTERNAL_ERROR",
        "Service configuration error",
      );
    }
    const data: ConversationCursorData = {
      v: 1,
      res: "conv_list",
      t: "conv_list",
      uid: params.userId,
      limit: params.limit,
      created_at: params.createdAt.toISOString(),
      cid: params.conversationId,
      filter_hash: params.filterHash ?? null,
      scope_hash: params.scopeHash ?? null,
      dir: "forward",
      exp: Date.now() + (params.ttlMs ?? CURSOR_TTL_MS),
    };
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  decodeConversationCursor(
    cursor: string,
    context: {
      userId: number;
      limit: number;
      filterHash?: string | null;
      scopeHash?: string | null;
    },
  ): { created_at: Date; id: number } {
    const secret = this.getSecret();
    if (!cursor || typeof cursor !== "string") {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor format");
    }
    const parts = cursor.split(".");
    if (parts.length !== 2 || !secret) {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor format");
    }
    const [payload, signature] = parts;
    const expected = createHmac("sha256", secret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      throw new CopilotError(400, "INVALID_CURSOR", "Invalid cursor signature");
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new CopilotError(
        400,
        "INVALID_CURSOR",
        "Invalid or tampered cursor signature",
      );
    }

    try {
      const data = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as ConversationCursorData;
      if (data.v !== 1) {
        throw new Error("Unsupported cursor version");
      }
      if (data.res && data.res !== "conv_list" && data.t !== "conv_list") {
        throw new Error("Incompatible cursor resource type");
      }
      if (data.uid !== context.userId) {
        throw new Error("Cursor belongs to another user");
      }
      if (data.limit !== context.limit) {
        throw new Error("Cursor limit does not match request limit");
      }
      if (data.exp < Date.now()) {
        throw new Error("Cursor has expired");
      }
      if (
        data.filter_hash &&
        context.filterHash &&
        data.filter_hash !== context.filterHash
      ) {
        throw new Error("Query filters do not match cursor context");
      }
      if (
        data.scope_hash &&
        context.scopeHash &&
        data.scope_hash !== context.scopeHash
      ) {
        throw new Error("Authorization scope does not match cursor context");
      }
      if (
        !Number.isSafeInteger(data.cid) ||
        Number.isNaN(Date.parse(data.created_at))
      ) {
        throw new Error("Invalid cursor position data");
      }
      return { created_at: new Date(data.created_at), id: data.cid };
    } catch (err: any) {
      throw new CopilotError(
        400,
        "INVALID_CURSOR",
        "Invalid or expired cursor",
      );
    }
  }
}

export const paginationService = new PaginationService();
