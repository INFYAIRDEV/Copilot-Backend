import { Router } from "express";
import { asyncHandler } from "../../shared/middlewares/responseHandler.js";
import { userController } from "./user.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.js";

const router = Router();

// Public route: no token needed to register.
router.post("/register", asyncHandler(userController.register));

// Public route: no token needed to log in.
router.post("/login", asyncHandler(userController.login));

router.post("/verify-email", asyncHandler(userController.verifyEmail));
router.post("/resend-otp", asyncHandler(userController.resendOtp));
router.post("/forgot-password", asyncHandler(userController.forgotPassword));
router.post("/reset-password", asyncHandler(userController.resetPassword));

// Protected: needs a Bearer token.
router.post(
  "/change-password",
  authenticate,
  asyncHandler(userController.changePassword),
);
// Protected route: requires a valid Bearer token.
router.get("/profile", authenticate, asyncHandler(userController.profile));
router.patch("/profile", authenticate, asyncHandler(userController.updateProfile));

export default router;
