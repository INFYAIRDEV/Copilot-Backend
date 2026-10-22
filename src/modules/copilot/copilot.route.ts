import { Router } from "express";
import { verifyAccessToken } from "../../shared/utils/jwt.js";
import { copilotController } from "./copilot.controller.js";


const router = Router();
router.use(verifyAccessToken);

// Sales Intelligence Copilot Endpoints (MVP Dynamic SQL Workflow)
router.post("/query", copilotController.query);
router.get("/usage", copilotController.getUsage);
router.get("/answers", copilotController.listAnswers);
router.get("/answers/:id", copilotController.getAnswerById);
router.get("/answers/:id/records", copilotController.getAnswerById);
router.get("/history", copilotController.listConversations);
router.get("/conversations/:id", copilotController.getConversation);


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
