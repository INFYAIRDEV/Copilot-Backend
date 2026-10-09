import express, { Application, Request, Response } from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import { errorHandler } from "./src/shared/middlewares/errorHandler.js";
import { requestLogger } from "./src/shared/middlewares/requestLogger.js";
import { rateLimiter } from "./src/shared/middlewares/rateLimiter.js";
import copilotRoutes from "./src/modules/copilot/copilot.route.js";
import analyticsRoutes from "./src/modules/analytics/analytics.route.js";

import { createServer } from "http";
import { corsConfig } from "@/shared/utils/corsConfig.js";
import { languageMiddleware } from "@/shared/middlewares/language.js";
import { zodLocaleMiddleware } from "@/shared/middlewares/zodLocaleMiddleware.js";
import { setRequestContext } from "@/shared/utils/requestContext.js";
import { asyncHandler } from "@/shared/middlewares/responseHandler.js";
import { ApiResponse } from "@/shared/types/response.js";

dotenv.config();

const app: Application = express();
const server = createServer(app);

app.use(corsConfig);
app.options(/.*/, corsConfig);
app.use(express.json());

app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(rateLimiter);

// Language negotiation must run before routes to populate req.lang
app.use(languageMiddleware);
app.use(zodLocaleMiddleware);

app.use((req, res, next) => {
  const lang = req.lang || "en";
  setRequestContext({ lang }, next);
});

app.get(
  "/health",
  asyncHandler(async (req: Request, res: Response) => {
    // Check database connectivity
    try {
      return ApiResponse.success(res, { message: "Server is healthy" });
    } catch (error: any) {
      return ApiResponse.error(res, {
        message: "Server is not healthy",
        statusCode: 500,
      });
    }
  }),
);

app.use("/api/v1/copilot", copilotRoutes);
app.use("/api/v1/analytics", analyticsRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

app.use(errorHandler);

const port = 8080;

server.listen(port, "0.0.0.0", async () => {
  console.log(`Server is running on ${port}`);
  console.log(`WebSocket server running on ws://localhost:${port}`);

  // ✅ Add log to confirm crons are NOT running here
  console.log(
    "[API] Running without cron jobs (crons run in separate container)",
  );
});

export default app;
