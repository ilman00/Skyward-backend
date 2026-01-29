import express from "express";
import { registerUser, loginUser, refreshToken, verifyOtp, resendOtp } from "../controllers/auth.controller";


const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshToken);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);

export default router;