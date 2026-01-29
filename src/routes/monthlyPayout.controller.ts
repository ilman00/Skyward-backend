import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createMonthlyPayout, getMonthlyPayouts, getRentPayouts } from "../controllers/monthlyPayout.controller";


const router = express.Router();
router.post("/monthly-payout", authenticate, authorize("admin", "staff"), createMonthlyPayout);
router.get("/monthly-payout", authenticate, authorize("admin", "staff"), getRentPayouts);
export default router;
