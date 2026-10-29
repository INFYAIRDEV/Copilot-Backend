import {
  Prisma,
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { prisma } from "../../shared/utils/prismaClient.js";
import { randomUUID } from "node:crypto";

async function auditedTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const target = (error as any)?.meta?.target;
      const isIdempotencyConflict =
        code === "P2002" &&
        (Array.isArray(target)
          ? target.includes("idempotency_key")
          : String(target || "").includes("idempotency_key"));
      if (isIdempotencyConflict) throw error;
      if (attempt >= 2 || (code !== "P2002" && code !== "P2034")) throw error;
    }
  }
}

export interface CreateMessageArgs {
  conversation_id: number;
  kind: message_kind;
  text: string | null;
  locale: locale_code;
  request_uuid: string;
  idempotency_key?: string | null;
  canonical_body_hash?: string | null;
  question_hash?: string | null;
  text_redacted?: boolean;
  role?: message_role;
}

export interface CreateAssistantMessageArgs {
  conversation_id: number;
  kind: message_kind;
  text: string | null;
  locale: locale_code;
  request_uuid?: string;
  text_redacted?: boolean;
}

export const conversationRepository = {
  create: (owner_user_id: number, locale?: locale_code) =>
    auditedTransaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          owner_user_id,
          conversation_uuid: randomUUID(),
          locale,
          updated_at: new Date(),
        },
        select: {
          id: true,
          conversation_uuid: true,
          locale: true,
          state: true,
          created_at: true,
          updated_at: true,
        },
      });
      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id: conversation.id,
        event_type: "CONVERSATION_CREATED",
        status: "SUCCESS",
        payload: { locale: conversation.locale },
      });
      const { id: _id, ...response } = conversation;
      return response;
    }),

  findOwned: (conversation_uuid: string, owner_user_id: number) =>
    prisma.conversation.findFirst({
      where: {
        conversation_uuid,
        owner_user_id,
      },
    }),

  findOwnedById: (id: number, owner_user_id: number) =>
    prisma.conversation.findFirst({
      where: {
        id,
        owner_user_id,
      },
    }),

  findById: (id: number) =>
    prisma.conversation.findUnique({
      where: { id },
    }),

  rename: (conversation_uuid: string, owner_user_id: number, title: string) =>
    auditedTransaction(async (tx) => {
      const conv = await tx.conversation.findFirst({
        where: {
          conversation_uuid,
          owner_user_id,
          deleted_at: null,
          state: { not: conversation_state.DELETED },
        },
      });

      if (!conv) {
        return null;
      }

      const existingContext =
        conv.analytical_context &&
        typeof conv.analytical_context === "object" &&
        !Array.isArray(conv.analytical_context)
          ? (conv.analytical_context as Record<string, any>)
          : {};

      const updatedContext = {
        ...existingContext,
        title: title.trim(),
      };

      const updated = await tx.conversation.update({
        where: { id: conv.id },
        data: {
          analytical_context: updatedContext,
          updated_at: new Date(),
        },
        select: {
          id: true,
          conversation_uuid: true,
          locale: true,
          state: true,
          analytical_context: true,
          created_at: true,
          updated_at: true,
        },
      });

      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id: conv.id,
        event_type: "CONVERSATION_RENAMED",
        status: "SUCCESS",
        payload: { title: title.trim() },
      });

      return {
        conversation_uuid: updated.conversation_uuid,
        title: title.trim(),
        updated_at: updated.updated_at,
      };
    }),

  softDelete: (conversation_uuid: string, owner_user_id: number) =>
    auditedTransaction(async (tx) => {
      const conv = await tx.conversation.findFirst({
        where: {
          conversation_uuid,
          owner_user_id,
          deleted_at: null,
          state: { not: conversation_state.DELETED },
        },
      });

      if (!conv) {
        return null;
      }

      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          state: conversation_state.DELETED,
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });

      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id: conv.id,
        event_type: "CONVERSATION_DELETED",
        status: "SUCCESS",
        payload: { conversation_uuid },
      });

      return {
        conversation_uuid: conv.conversation_uuid,
        deleted: true,
      };
    }),

  setPin: (conversation_uuid: string, owner_user_id: number, is_pinned: boolean) =>
    auditedTransaction(async (tx) => {
      const conv = await tx.conversation.findFirst({
        where: {
          conversation_uuid,
          owner_user_id,
          deleted_at: null,
          state: { not: conversation_state.DELETED },
        },
      });

      if (!conv) {
        return null;
      }

      const updated = await (tx.conversation as any).update({
        where: { id: conv.id },
        data: {
          is_pinned,
          updated_at: new Date(),
        },
        select: {
          id: true,
          conversation_uuid: true,
          locale: true,
          state: true,
          analytical_context: true,
          is_pinned: true,
          created_at: true,
          updated_at: true,
        },
      });

      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id: conv.id,
        event_type: is_pinned ? "CONVERSATION_PINNED" : "CONVERSATION_UNPINNED",
        status: "SUCCESS",
        payload: { conversation_uuid, is_pinned },
      });

      return {
        conversation_uuid: updated.conversation_uuid,
        is_pinned: (updated as any).is_pinned ?? is_pinned,
        updated_at: updated.updated_at,
      };
    }),



  updateAnalyticalContext: async (
    conversation_id: number,
    expected_version: number,
    context: any,
    auditArgs?: {
      request_uuid?: string;
      scope_hash?: string;
    },
  ) =>
    auditedTransaction(async (tx) => {
      const updated = await tx.conversation.updateMany({
        where: {
          id: conversation_id,
          version: expected_version,
        },
        data: {
          analytical_context: context,
          version: { increment: 1 },
          updated_at: new Date(),
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await appendAudit(tx, {
        request_uuid: auditArgs?.request_uuid || randomUUID(),
        conversation_id,
        event_type: "ANALYTICAL_CONTEXT_UPDATED",
        status: "SUCCESS",
        scope_hash: auditArgs?.scope_hash,
        payload: {
          version: expected_version + 1,
          metric_refs: context?.metricRefs || [],
          dimension_refs: context?.dimensionRefs || [],
        },
      });

      return true;
    }),

  findIdempotentMessage: (conversation_id: number, idempotency_key: string) =>
    prisma.conversation_message.findUnique({
      where: {
        conversation_id_idempotency_key: { conversation_id, idempotency_key },
      },
    }),

  createMessage: async (args: CreateMessageArgs) =>
    auditedTransaction(async (tx) => {
      const role = args.role || message_role.USER;
      const message = await tx.conversation_message.create({
        data: {
          conversation_id: args.conversation_id,
          role,
          kind: args.kind,
          text: args.text,
          text_redacted: args.text_redacted ?? false,
          locale: args.locale,
          request_uuid: args.request_uuid,
          idempotency_key: args.idempotency_key ?? null,
          canonical_body_hash: args.canonical_body_hash ?? null,
          question_hash: args.question_hash ?? null,
        },
        select: {
          id: true,
          role: true,
          kind: true,
          text: true,
          text_redacted: true,
          locale: true,
          request_uuid: true,
          idempotency_key: true,
          canonical_body_hash: true,
          created_at: true,
        },
      });
      await tx.conversation.update({
        where: { id: args.conversation_id },
        data: { updated_at: new Date() },
      });
      await appendAudit(tx, {
        request_uuid: args.request_uuid,
        conversation_id: args.conversation_id,
        event_type:
          role === message_role.ASSISTANT
            ? "ASSISTANT_MESSAGE_CREATED"
            : "MESSAGE_CREATED",
        status: "SUCCESS",
        payload: {
          role,
          kind: args.kind,
          question_hash: args.question_hash ?? null,
        },
      });
      return message;
    }),

  createAssistantMessage: async (args: CreateAssistantMessageArgs) =>
    conversationRepository.createMessage({
      conversation_id: args.conversation_id,
      role: message_role.ASSISTANT,
      kind: args.kind,
      text: args.text,
      locale: args.locale,
      request_uuid: args.request_uuid || randomUUID(),
      text_redacted: args.text_redacted ?? false,
      idempotency_key: null,
      canonical_body_hash: null,
      question_hash: null,
    }),

  findMessagesByConversationId: async (conversation_id: number) =>
    prisma.conversation_message.findMany({
      where: { conversation_id },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select: {
        id: true,
        role: true,
        kind: true,
        text: true,
        text_redacted: true,
        locale: true,
        request_uuid: true,
        idempotency_key: true,
        created_at: true,
      },
    }),

  historyPage: async (
    conversation_id: number,
    after?: { created_at: Date; id: number },
    limit = 50,
  ) => {
    const rows = await prisma.conversation_message.findMany({
      where: {
        conversation_id,
        ...(after
          ? {
              OR: [
                { created_at: { gt: after.created_at } },
                { created_at: after.created_at, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        role: true,
        kind: true,
        text: true,
        text_redacted: true,
        locale: true,
        request_uuid: true,
        created_at: true,
      },
    });
    return rows;
  },

  listUserConversations: async (
    owner_user_id: number,
    after?: { created_at: Date; id: number },
    limit = 50,
  ) => {
    try {
      const rows = await (prisma.conversation as any).findMany({
        where: {
          owner_user_id,
          deleted_at: null,
          state: { not: conversation_state.DELETED },
          ...(after
            ? {
                OR: [
                  { created_at: { lt: after.created_at } },
                  { created_at: after.created_at, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [
          { is_pinned: "desc" },
          { created_at: "desc" },
          { id: "desc" },
        ],
        take: limit + 1,
        select: {
          id: true,
          conversation_uuid: true,
          locale: true,
          state: true,
          analytical_context: true,
          is_pinned: true,
          created_at: true,
          updated_at: true,
          conversation_message: {
            where: { role: message_role.USER },
            orderBy: { created_at: "asc" },
            take: 1,
            select: { text: true },
          },
        },
      });
      return rows;
    } catch {
      // Graceful fallback for queries before the database column is added in Postgres
      const rows = await prisma.conversation.findMany({
        where: {
          owner_user_id,
          deleted_at: null,
          state: { not: conversation_state.DELETED },
          ...(after
            ? {
                OR: [
                  { created_at: { lt: after.created_at } },
                  { created_at: after.created_at, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          conversation_uuid: true,
          locale: true,
          state: true,
          analytical_context: true,
          created_at: true,
          updated_at: true,
          conversation_message: {
            where: { role: message_role.USER },
            orderBy: { created_at: "asc" },
            take: 1,
            select: { text: true },
          },
        },
      });
      return rows;
    }
  },

  auditHistoryRead: (args: {
    conversation_id: number;
    request_uuid: string;
    scope_hash: string;
    query_fingerprint: string;
    output_hash: string;
    returned_count: number;
  }) =>
    auditedTransaction(async (tx) => {
      await appendAudit(tx, {
        request_uuid: args.request_uuid,
        conversation_id: args.conversation_id,
        event_type: "CONVERSATION_HISTORY_READ",
        status: "SUCCESS",
        scope_hash: args.scope_hash,
        query_fingerprint: args.query_fingerprint,
        output_hash: args.output_hash,
        payload: { returned_count: args.returned_count },
      });
    }),

  auditConversationListRead: (args: {
    owner_user_id: number;
    request_uuid: string;
    scope_hash: string;
    query_fingerprint: string;
    output_hash: string;
    returned_count: number;
  }) =>
    auditedTransaction(async (tx) => {
      await appendAudit(tx, {
        request_uuid: args.request_uuid,
        conversation_id: null,
        event_type: "CONVERSATION_LIST_READ",
        status: "SUCCESS",
        scope_hash: args.scope_hash,
        query_fingerprint: args.query_fingerprint,
        output_hash: args.output_hash,
        payload: {
          owner_user_id: args.owner_user_id,
          returned_count: args.returned_count,
        },
      });
    }),

  // ─── Share conversation methods ───────────────────────────────────────

  /**
   * Create or update a shared link for a conversation.
   * If one already exists, refreshes the snapshot and re-activates it.
   */
  upsertShare: (args: {
    conversation_id: number;
    user_id: number;
    title: string | null;
    snapshot_data: any;
    share_id: string;
  }) =>
    auditedTransaction(async (tx) => {
      const existing = await (tx as any).shared_conversation.findUnique({
        where: { conversation_id: args.conversation_id },
      });

      let record;
      if (existing) {
        // Re-activate & refresh snapshot for an existing share
        record = await (tx as any).shared_conversation.update({
          where: { id: existing.id },
          data: {
            title: args.title ?? existing.title,
            snapshot_data: args.snapshot_data,
            is_active: true,
            revoked_at: null,
            updated_at: new Date(),
          },
        });
      } else {
        record = await (tx as any).shared_conversation.create({
          data: {
            share_id: args.share_id,
            conversation_id: args.conversation_id,
            user_id: args.user_id,
            title: args.title,
            snapshot_data: args.snapshot_data,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      }

      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id: args.conversation_id,
        event_type: "CONVERSATION_SHARED",
        status: "SUCCESS",
        payload: {
          share_id: record.share_id,
          title: record.title,
          is_update: !!existing,
        },
      });

      return record;
    }),

  /** Look up an existing share record for a conversation owned by a user. */
  findShareByConversationId: async (conversation_id: number, user_id: number) => {
    return (prisma as any).shared_conversation.findFirst({
      where: {
        conversation_id,
        user_id,
      },
    });
  },

  /** Public lookup – used by the unauthenticated GET /share/:shareId route. */
  findActiveShareByShareId: async (share_id: string) => {
    return (prisma as any).shared_conversation.findFirst({
      where: {
        share_id,
        is_active: true,
      },
    });
  },

  /** Fire-and-forget view-count bump. */
  incrementShareViewCount: async (share_id: string) => {
    try {
      await (prisma as any).shared_conversation.update({
        where: { share_id },
        data: {
          view_count: { increment: 1 },
        },
      });
    } catch {
      // background increment – swallow errors
    }
  },

  /** Revoke (soft-delete) the shared link for a conversation. */
  revokeShare: (conversation_id: number, user_id: number) =>
    auditedTransaction(async (tx) => {
      const existing = await (tx as any).shared_conversation.findFirst({
        where: {
          conversation_id,
          user_id,
          is_active: true,
        },
      });

      if (!existing) {
        return null;
      }

      const updated = await (tx as any).shared_conversation.update({
        where: { id: existing.id },
        data: {
          is_active: false,
          revoked_at: new Date(),
          updated_at: new Date(),
        },
      });

      await appendAudit(tx, {
        request_uuid: randomUUID(),
        conversation_id,
        event_type: "CONVERSATION_SHARE_REVOKED",
        status: "SUCCESS",
        payload: {
          share_id: existing.share_id,
        },
      });

      return updated;
    }),
};

export async function appendAudit(
  tx: Prisma.TransactionClient,
  event: {
    request_uuid: string;
    conversation_id?: number | null;
    event_type: string;
    status: string;
    payload: Prisma.InputJsonValue;
    scope_hash?: string;
    query_fingerprint?: string;
    output_hash?: string;
  },
) {
  const event_day = new Date();
  event_day.setUTCHours(0, 0, 0, 0);
  const previous = await tx.audit_event.findFirst({
    where: { event_day },
    orderBy: { sequence: "desc" },
    select: { sequence: true, event_hash: true },
  });
  const sequence = (previous?.sequence ?? 0) + 1;
  const previous_hash = previous?.event_hash ?? null;
  const redacted_payload = event.payload;
  const crypto = await import("node:crypto");
  const event_hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ event_day, sequence, previous_hash, ...event }))
    .digest("hex");
  await tx.audit_event.create({
    data: {
      event_day,
      sequence,
      previous_hash,
      event_hash,
      request_uuid: event.request_uuid,
      conversation_id: event.conversation_id ?? null,
      event_type: event.event_type,
      status: event.status,
      redacted_payload,
      scope_hash: event.scope_hash,
      query_fingerprint: event.query_fingerprint,
      output_hash: event.output_hash,
    },
  });
}
