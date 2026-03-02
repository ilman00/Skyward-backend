import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { pool } from "../config/db";
import { JwtUser } from "../types/types";

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication token missing"
    });
  }

  try {
    const decoded = verifyToken(token) as JwtUser;

    // ⭐ Fetch fresh status from DB
    const result = await pool.query(
      `SELECT status FROM users WHERE user_id = $1`,
      [decoded.user_id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account is not active"
      });
    }

    req.user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
};