import { Request, Response, NextFunction } from "express";
import { JwtUser } from "../types/types";

export const authorize =
  (...allowedRoles: JwtUser["role"][]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        message: "Unauthorized"
      });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  };
