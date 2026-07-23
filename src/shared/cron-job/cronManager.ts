import cron, { ScheduledTask } from "node-cron";

export interface CronJobConfig {
  name: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  handler: () => Promise<void>;
  description?: string;
}

class CronManager {
  private jobs: Map<string, ScheduledTask> = new Map();
  private config: Map<string, CronJobConfig> = new Map();

  register(config: CronJobConfig): void {
    if (this.jobs.has(config.name)) {
      console.warn(`Job ${config.name} already registered`);
      return;
    }
    if (config.enabled === false) {
      console.warn(`Job ${config.name} is disabled`);
      return;
    }

    try {
      const task = cron.schedule(
        config.schedule,
        async () => {
          const startTime = Date.now();
          console.log(`[CRON] Starting job ${config.name}`);

          try {
            await config.handler();
            const duration = Date.now() - startTime;
            console.log(`[CRON] Job ${config.name} completed in ${duration}ms`);
          } catch (error: any) {
            console.error(`[CRON] Job ${config.name} failed:`, error);
          }
        },
        {
          timezone: config.timezone || "UTC",
        },
      );
      task.stop();
      this.jobs.set(config.name, task);
      this.config.set(config.name, config);
      console.log(`[CRON] Job ${config.name} registered successfully`);
    } catch (error: any) {
      console.error(`[CRON] Failed to register job ${config.name}:`, error);
    }
  }

  unregister(name: string): void {
    const task = this.jobs.get(name);
    if (task) {
      task.stop();
      this.jobs.delete(name);
      this.config.delete(name);
      console.log(`[CRON] Job ${name} unregistered successfully`);
    }
  }

  getJobs(): Array<{
    name: string;
    schedule: string;
    enabled: boolean;
    description?: string;
  }> {
    return Array.from(this.config.values()).map((config) => ({
      name: config.name,
      schedule: config.schedule,
      enabled: config.enabled !== false,
      description: config.description,
    }));
  }

  startAll(): void {
    console.log(`[CRON] 📋 Starting ${this.jobs.size} cron job(s)`);
    this.jobs.forEach((task, name) => {
      task.start();
      console.log(`[CRON] ▶️  Started job: ${name}`);
    });
  }

  stopAll(): void {
    console.log(`[CRON] 🛑 Stopping all cron jobs`);
    this.jobs.forEach((task, name) => {
      task.stop();
      console.log(`[CRON] ⏹️  Stopped job: ${name}`);
    });
  }
}

export const cronManager = new CronManager();
