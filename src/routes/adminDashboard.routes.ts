import { Router } from "express";
import { getDashboardStats } from "../controllers/adminDashboard.controller";
import { authenticate } from "../middlewares/authenticate"; // adjust path if needed
import { authorize } from "../middlewares/authorize"; // adjust path if needed

const router = Router();

// Only admin and staff can view dashboard stats
router.get(
  "/dashboard/stats",
  authenticate,
  authorize("admin", "staff"),
  getDashboardStats
);

export default router;