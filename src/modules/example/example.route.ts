import { asyncHandler } from "@/shared/middlewares/responseHandler.js";
import { restrictOperatorAccess, verifyAccessToken } from "@/shared/utils/jwt.js";
import { Router } from "express";
import {exampleController} from "./example.controller.js";


const router = Router();

router.post(
  "/createProductionOrder",
  verifyAccessToken,  
  restrictOperatorAccess,
  asyncHandler(exampleController),
);

export default router;
