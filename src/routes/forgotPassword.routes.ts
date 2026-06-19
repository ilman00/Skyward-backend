import express from "express";
import { forgotPassword, verifyForgotOtp, resetPassword } from "../controllers/forgotPassword.controller";

const router = express.Router();

router.post("/forgot-password", forgotPassword);
router.post("/verify-forgot-otp", verifyForgotOtp);
router.post("/reset-password", resetPassword);

export default router;