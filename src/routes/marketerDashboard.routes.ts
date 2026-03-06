import { Router } from "express";
import {
  getMarketerDashboardSummary,
  getMarketerClients,
} from "../controllers/marketerDashboard.controller"; // adjust path as needed
import { authenticate } from "../middlewares/authenticate";   // your existing auth middleware
import { authorize } from "../middlewares/authorize"; // your existing role guard

const router = Router();

router.get(
  "/dashboard/summary",
  authenticate,
  authorize("admin", "marketer"),
  getMarketerDashboardSummary
);

router.get(
  "/dashboard/clients",
  authenticate,
  authorize("admin", "marketer"),
  getMarketerClients
);

export default router;