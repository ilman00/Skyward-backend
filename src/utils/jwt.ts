// src/utils/jwt.ts
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const JWT_SECRET = env.jwtSecret;
const JWT_REFRESH_SECRET = env.jwtRefreshSecret;

export const createAccessToken = (payload: object) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
};

export const createRefreshToken = (payload: object) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" });
};

// ✅ Used for temporary OTP storage (valid for 10 minutes)
export const createOtpToken = (email: string, otp: string) => {
  return jwt.sign({ email, otp }, JWT_SECRET, { expiresIn: "10m" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET);
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}