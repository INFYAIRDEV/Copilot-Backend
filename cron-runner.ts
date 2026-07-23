import { initializeCronJobs } from "./src/shared/cron-job/jobRegistry.js";
import { prisma } from "./src/shared/utils/prismaClient.js";

async function startCron() {
  console.log("[CRON-RUNNER] Starting at", new Date().toISOString());

  try {
    // Connect to DB
    await prisma.$connect();
    console.log("[CRON-RUNNER] Database connected");

    // Initialize and start cron jobs
    initializeCronJobs();
    console.log("[CRON-RUNNER] All cron jobs initialized");

    // Keep process alive
    process.on("SIGTERM", async () => {
      console.log("[CRON-RUNNER] Received SIGTERM, cleaning up...");
      await prisma.$disconnect();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("[CRON-RUNNER] Received SIGINT, cleaning up...");
      await prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error("[CRON-RUNNER] Fatal error:", error);
    process.exit(1);
  }
}

startCron();
