import { Router } from "express";
import {
  getMarketerDashboardSummary,
  getMarketerClients,
  getMarketerEarnings,
  getMarketerCustomers
} from "../controllers/marketerDashboard.controller"; // adjust path as needed
import { authenticate } from "../middlewares/authenticate";   // your existing auth middleware
import { authorize } from "../middlewares/authorize"; // your existing role guard

const router = Router();

router.get(
  "/marketer/dashboard/summary",
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

router.get(
  "/marketer/dashboard/earnings",
  authenticate,
  authorize("admin", "marketer"),
  getMarketerEarnings
);

router.get(
  "/marketer/dashboard/customers",
  authenticate,
  authorize("admin", "marketer"),
  getMarketerCustomers
);


export default router;