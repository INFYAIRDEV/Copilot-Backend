import { Router } from "express";
import { asyncHandler } from "@/shared/middlewares/responseHandler.js";
import { verifyAccessToken } from "@/shared/utils/jwt.js";
import { copilotController } from "./copilot.controller.js";

const router = Router();

router.post(
  "/analytical-plan",
  verifyAccessToken,
  asyncHandler(copilotController.generateAnalyticalPlan),
);

export default router;
