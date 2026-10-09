import { Router } from "express";
import { analyticsController } from "./analytics.controller.js";

const router = Router();

// Golden validation regression check
router.get("/golden-validation", analyticsController.getGoldenValidation);

// Certified metric definitions
router.get("/metrics/:id", analyticsController.getMetricDefinition);

export default router;
