import { Request, Response } from "express";
import { fetchStaffDashboardSummary } from "../queries/staffDashboard.queries";

export const getStaffDashboardSummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (!user || !user.user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = user.user_id;

    const data = await fetchStaffDashboardSummary(userId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Staff dashboard summary error", error);

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};