import { Router } from "express";
import { verifyAccessToken } from "@/shared/utils/jwt.js";
import { copilotController } from "./copilot.controller.js";
import { analyticsController } from "@/modules/analytics/analytics.controller.js";

const router = Router();

// Track A Demonstrator Answer Endpoints (Accessible for UI and demo queries)
router.get("/answers", analyticsController.listAnswers);
router.get("/answers/:id", analyticsController.getAnswerById);
router.get("/answers/:id/records", analyticsController.getSupportingRecords);
router.post("/query", analyticsController.queryPipeline);
router.get("/history", analyticsController.getHistory);
router.get("/conversations/:id", analyticsController.getConversation);

router.use(verifyAccessToken);
router.get("/conversations", copilotController.listConversations);
router.post("/conversations", copilotController.create);
router.post("/conversations/:id/messages", copilotController.sendMessage);
router.post(
  "/conversations/:id/messages/stream",
  copilotController.streamMessage,
);
router.post("/conversations/:id/stream", copilotController.streamMessage);
router.get("/conversations/:id/messages", copilotController.history);

import { copilotAnalyticalController } from "./copilot.controller.js";

router.post(
  "/analytical-plan",
  copilotAnalyticalController.generateAnalyticalPlan,
);

export default router;
