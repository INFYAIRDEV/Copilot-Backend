import { cronManager } from "./cronManager.js";
import { exampleJob } from "./jobs/example-cron.js";

export function registerAllJobs(): void {
  console.log("[CRON] Registering all jobs...");

  cronManager.register({
    name: "example-cron-job-name",
    schedule: "* * * * *",
    handler: exampleJob,
    description: "Cron job description here",
    enabled: true,
    timezone: "UTC",
  });
}

export function initializeCronJobs(): void {
  try {
    console.log("[CRON] Initializing cron jobs...");
    registerAllJobs();
    cronManager.startAll();
    console.log("[CRON] Cron jobs initialized successfully");
  } catch (error: any) {
    console.error("[CRON] Error initializing cron jobs:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}
