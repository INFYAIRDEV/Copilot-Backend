import { Router } from "express";
import { verifyAccessToken } from "@/shared/utils/jwt.js";
import { copilotController } from "./copilot.controller.js";

const router = Router();
router.use(verifyAccessToken);
router.get("/conversations", copilotController.listConversations);
router.post("/conversations", copilotController.create);
router.post("/conversations/:id/messages", copilotController.sendMessage);
router.get("/conversations/:id/messages", copilotController.history);

import { copilotAnalyticalController } from "./copilot.controller.js";

router.post(
  "/analytical-plan",
  verifyAccessToken,
  copilotAnalyticalController.generateAnalyticalPlan,
);

export default router;
