import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { JwtUser } from "../types/types";

export const authenticate = (
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

    req.user = decoded; // ✅ attached safely
    next();

  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
};
