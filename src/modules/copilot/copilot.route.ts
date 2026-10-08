import { Router } from "express";
import { verifyAccessToken } from "@/shared/utils/jwt.js";
import { copilotController } from "./copilot.controller.js";

const router = Router();
router.use(verifyAccessToken);
router.post("/conversations", copilotController.create);
router.post("/conversations/:id/messages", copilotController.sendMessage);
router.get("/conversations/:id/messages", copilotController.history);

router.post(
  "/analytical-plan",
  verifyAccessToken,
  copilotController.generateAnalyticalPlan,
);

export default router;
