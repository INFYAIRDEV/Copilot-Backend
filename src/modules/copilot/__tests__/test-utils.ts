import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  CreateMessageArgs,
  CreateAssistantMessageArgs,
} from "../conversation.repository.js";

export interface MockConversation {
  id: number;
  conversation_uuid: string;
  owner_user_id: number;
  locale: locale_code;
  state: conversation_state;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MockMessage {
  id: number;
  conversation_id: number;
  role: message_role;
  kind: message_kind;
  text: string | null;
  text_redacted: boolean;
  question_hash: string | null;
  locale: locale_code;
  request_uuid: string | null;
  idempotency_key: string | null;
  canonical_body_hash: string | null;
  created_at: Date;
}

export interface MockAuditEvent {
  sequence: number;
  request_uuid: string;
  conversation_id: number;
  event_type: string;
  status: string;
  payload: any;
}

export function createMockConversationRepository(initialData?: {
  conversations?: MockConversation[];
  messages?: MockMessage[];
}) {
  let nextConvId = 1;
  let nextMsgId = 1;
  let nextAuditSeq = 1;

  const conversations: MockConversation[] = initialData?.conversations
    ? [...initialData.conversations]
    : [];
  const messages: MockMessage[] = initialData?.messages
    ? [...initialData.messages]
    : [];
  const audits: MockAuditEvent[] = [];

  // Update IDs counter
  for (const c of conversations) {
    if (c.id >= nextConvId) nextConvId = c.id + 1;
  }
  for (const m of messages) {
    if (m.id >= nextMsgId) nextMsgId = m.id + 1;
  }

  return {
    conversations,
    messages,
    audits,

    async create(owner_user_id: number, locale: locale_code = locale_code.en) {
      const conv: MockConversation = {
        id: nextConvId++,
        conversation_uuid: randomUUID(),
        owner_user_id,
        locale,
        state: conversation_state.ACTIVE,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      conversations.push(conv);
      audits.push({
        sequence: nextAuditSeq++,
        request_uuid: randomUUID(),
        conversation_id: conv.id,
        event_type: "CONVERSATION_CREATED",
        status: "SUCCESS",
        payload: { locale: conv.locale },
      });
      const { id: _id, ...rest } = conv;
      return rest;
    },

    async findOwned(conversation_uuid: string, owner_user_id: number) {
      return (
        conversations.find(
          (c) =>
            c.conversation_uuid === conversation_uuid &&
            c.owner_user_id === owner_user_id,
        ) || null
      );
    },

    async findById(id: number) {
      return conversations.find((c) => c.id === id) || null;
    },

    async findIdempotentMessage(
      conversation_id: number,
      idempotency_key: string,
    ) {
      return (
        messages.find(
          (m) =>
            m.conversation_id === conversation_id &&
            m.idempotency_key === idempotency_key,
        ) || null
      );
    },

    async createMessage(args: CreateMessageArgs) {
      // Simulate unique constraint: @@unique([conversation_id, idempotency_key])
      if (args.idempotency_key) {
        const existing = messages.find(
          (m) =>
            m.conversation_id === args.conversation_id &&
            m.idempotency_key === args.idempotency_key,
        );
        if (existing) {
          const err: any = new Error(
            `Unique constraint failed on the fields: (conversation_id, idempotency_key)`,
          );
          err.code = "P2002";
          err.meta = { target: ["conversation_id", "idempotency_key"] };
          throw err;
        }
      }

      const role = args.role || message_role.USER;
      const msg: MockMessage = {
        id: nextMsgId++,
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
        created_at: new Date(),
      };
      messages.push(msg);

      const conv = conversations.find((c) => c.id === args.conversation_id);
      if (conv) {
        conv.updated_at = new Date();
      }

      audits.push({
        sequence: nextAuditSeq++,
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

      return {
        id: msg.id,
        role: msg.role,
        kind: msg.kind,
        text: msg.text,
        text_redacted: msg.text_redacted,
        locale: msg.locale,
        request_uuid: msg.request_uuid,
        idempotency_key: msg.idempotency_key,
        canonical_body_hash: msg.canonical_body_hash,
        created_at: msg.created_at,
      };
    },

    async createAssistantMessage(args: CreateAssistantMessageArgs) {
      return this.createMessage({
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
      });
    },

    async findMessagesByConversationId(conversation_id: number) {
      return messages
        .filter((m) => m.conversation_id === conversation_id)
        .sort((a, b) => {
          const timeDiff = a.created_at.getTime() - b.created_at.getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id - b.id;
        })
        .map((m) => ({
          id: m.id,
          role: m.role,
          kind: m.kind,
          text: m.text,
          text_redacted: m.text_redacted,
          locale: m.locale,
          request_uuid: m.request_uuid,
          idempotency_key: m.idempotency_key,
          created_at: m.created_at,
        }));
    },

    async historyPage(
      conversation_id: number,
      after?: { created_at: Date; id: number },
      limit = 50,
    ) {
      const filtered = messages
        .filter((m) => m.conversation_id === conversation_id)
        .filter((m) => {
          if (!after) return true;
          if (m.created_at > after.created_at) return true;
          if (
            m.created_at.getTime() === after.created_at.getTime() &&
            m.id > after.id
          )
            return true;
          return false;
        })
        .sort((a, b) => {
          const timeDiff = a.created_at.getTime() - b.created_at.getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id - b.id;
        });

      return filtered.slice(0, limit + 1).map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind,
        text: m.text,
        text_redacted: m.text_redacted,
        locale: m.locale,
        created_at: m.created_at,
      }));
    },

    async auditHistoryRead(args: any) {
      audits.push({
        sequence: nextAuditSeq++,
        request_uuid: args.request_uuid,
        conversation_id: args.conversation_id,
        event_type: "CONVERSATION_HISTORY_READ",
        status: "SUCCESS",
        payload: { returned_count: args.returned_count },
      });
    },
  };
}
