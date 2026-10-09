import { prisma } from "../../../shared/utils/prismaClient.js";

async function main() {
  console.log("Connecting to PostgreSQL...");
  const t0 = Date.now();
  const res = await prisma.$queryRawUnsafe("SELECT 1 AS connected;");
  console.log("Connected in", Date.now() - t0, "ms:", res);

  const salesCount = await prisma.$queryRawUnsafe<any[]>(
    "SELECT COUNT(*) FROM analytics.v_sales_transaction_fact;",
  );
  console.log("analytics.v_sales_transaction_fact count:", salesCount);

  const manifest = await prisma.$queryRawUnsafe<any[]>(
    "SELECT * FROM analytics.dataset_manifest;",
  );
  console.log("Manifest:", manifest);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
