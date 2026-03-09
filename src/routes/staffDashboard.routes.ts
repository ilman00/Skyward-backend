import { Router } from "express";
import { getStaffDashboardSummary } from "../controllers/staffDashboard.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

const router = Router();

router.get("/staff/dashboard/summary", authenticate, authorize("admin", "staff") , getStaffDashboardSummary);

export default router;