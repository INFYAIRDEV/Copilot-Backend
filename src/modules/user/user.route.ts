import { Router } from "express";
import { asyncHandler } from "../../shared/middlewares/responseHandler.js";
import { userController } from "./user.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.js";

const router = Router();

// Public route: no token needed to register.
router.post("/register", asyncHandler(userController.register));

// Public route: no token needed to log in.
router.post("/login", asyncHandler(userController.login));

// Protected route: requires a valid Bearer token.
router.get("/profile", authenticate, asyncHandler(userController.profile));

export default router;
