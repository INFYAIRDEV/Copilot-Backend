import { prisma } from "../../../shared/utils/prismaClient.js";

async function main() {
  const users = await prisma.$queryRawUnsafe<any[]>(
    "SELECT * FROM analytics.users LIMIT 5;",
  );
  console.log("USERS:", users);

  const convs = await prisma.$queryRawUnsafe<any[]>(
    "SELECT * FROM analytics.conversation LIMIT 5;",
  );
  console.log("CONVERSATIONS:", convs);

  const messages = await prisma.$queryRawUnsafe<any[]>(
    "SELECT id, conversation_id, role, text, created_at FROM analytics.conversation_message LIMIT 10;",
  );
  console.log("MESSAGES:", messages);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
