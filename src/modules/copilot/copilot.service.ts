import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { conversation_state, locale_code, message_kind } from "@prisma/client";
import { conversationRepository } from "./conversation.repository.js";

export class CopilotError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const cursorSecret = () =>
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const bodyHash = (body: { kind: string; text: string; locale: string }) =>
  sha256(
    JSON.stringify({ kind: body.kind, text: body.text, locale: body.locale }),
  );
const publicMessage = (message: {
  id: number;
  role: string;
  kind: string;
  text: string | null;
  text_redacted: boolean;
  locale: string;
  created_at: Date;
}) => ({
  id: message.id,
  role: message.role,
  kind: message.kind,
  text: message.text_redacted ? null : message.text,
  redacted: message.text_redacted,
  locale: message.locale,
  created_at: message.created_at,
});

type CursorData = {
  v: 1;
  uid: number;
  cid: number;
  limit: number;
  created_at: string;
  mid: number;
  exp: number;
};
function encodeCursor(data: CursorData) {
  const secret = cursorSecret();
  if (!secret)
    throw new CopilotError(
      500,
      "INTERNAL_ERROR",
      "Service configuration error",
    );
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}
function decodeCursor(
  cursor: string,
  uid: number,
  cid: number,
  limit: number,
): { created_at: Date; id: number } {
  const secret = cursorSecret();
  const [payload, signature, extra] = cursor.split(".");
  if (!secret || !payload || !signature || extra)
    throw new CopilotError(400, "INVALID_CURSOR", "Invalid history cursor");
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new CopilotError(400, "INVALID_CURSOR", "Invalid history cursor");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new CopilotError(400, "INVALID_CURSOR", "Invalid history cursor");
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as CursorData;
    if (
      data.v !== 1 ||
      data.uid !== uid ||
      data.cid !== cid ||
      data.limit !== limit ||
      data.exp < Date.now() ||
      !Number.isSafeInteger(data.mid) ||
      Number.isNaN(Date.parse(data.created_at))
    )
      throw new Error();
    return { created_at: new Date(data.created_at), id: data.mid };
  } catch {
    throw new CopilotError(
      400,
      "INVALID_CURSOR",
      "Invalid or expired history cursor",
    );
  }
}

export const copilotService = {
  async createConversation(userId: number, locale?: string) {
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw new CopilotError(401, "UNAUTHENTICATED", "Authentication required");
    return conversationRepository.create(
      userId,
      locale as locale_code | undefined,
    );
  },

  async sendMessage(
    userId: number,
    conversationUuid: string,
    key: string,
    body: { kind: string; text: string; locale?: string },
  ) {
    const conversation = await conversationRepository.findOwned(
      conversationUuid,
      userId,
    );
    if (!conversation)
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "Conversation access denied",
      );
    if (conversation.state !== conversation_state.ACTIVE)
      throw new CopilotError(
        409,
        "CONVERSATION_NOT_ACTIVE",
        "Conversation is not active",
      );
    const locale = (body.locale || conversation.locale) as locale_code;
    const hash = bodyHash({ kind: body.kind, text: body.text, locale });
    const prior = await conversationRepository.findIdempotentMessage(
      conversation.id,
      key,
    );
    if (prior) {
      if (prior.canonical_body_hash !== hash)
        throw new CopilotError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key was used with a different request body",
        );
      return publicMessage(prior);
    }
    const request_uuid = randomUUID();
    try {
      const created = await conversationRepository.createMessage({
        conversation_id: conversation.id,
        kind: body.kind as message_kind,
        text: body.text,
        locale,
        request_uuid,
        idempotency_key: key,
        canonical_body_hash: hash,
        question_hash: sha256(body.text),
      });
      return publicMessage(created);
    } catch (error) {
      // Resolve concurrent requests by reading the unique key winner.
      const raced = await conversationRepository.findIdempotentMessage(
        conversation.id,
        key,
      );
      if (raced) {
        if (raced.canonical_body_hash !== hash)
          throw new CopilotError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key was used with a different request body",
          );
        return publicMessage(raced);
      }
      throw error;
    }
  },

  async history(
    userId: number,
    conversationUuid: string,
    limit: number,
    cursor?: string,
  ) {
    const conversation = await conversationRepository.findOwned(
      conversationUuid,
      userId,
    );
    if (!conversation)
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "Conversation access denied",
      );
    const after = cursor
      ? decodeCursor(cursor, userId, conversation.id, limit)
      : undefined;
    const rows = await conversationRepository.historyPage(
      conversation.id,
      after,
      limit,
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            v: 1,
            uid: userId,
            cid: conversation.id,
            limit,
            created_at: last.created_at.toISOString(),
            mid: last.id,
            exp: Date.now() + 15 * 60 * 1000,
          })
        : null;
    await conversationRepository.auditHistoryRead({
      conversation_id: conversation.id,
      request_uuid: randomUUID(),
      scope_hash: sha256(`user:${userId}:conversation:read`),
      query_fingerprint: sha256(
        JSON.stringify({ limit, cursor: cursor ? sha256(cursor) : null }),
      ),
      output_hash: sha256(
        JSON.stringify(
          page.map(({ id, role, kind, created_at }) => ({
            id,
            role,
            kind,
            created_at,
          })),
        ),
      ),
      returned_count: page.length,
    });
    return {
      conversation: {
        conversation_uuid: conversation.conversation_uuid,
        locale: conversation.locale,
        state: conversation.state,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      },
      messages: page.map(publicMessage),
      page: { limit, next_cursor: nextCursor, has_more: hasMore },
    };
  },
};
