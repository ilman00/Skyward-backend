import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createSmdClosing, getSmdClosings } from "../controllers/smdClosing.controller";

const router = express.Router();
router.post("/smd-closings", authenticate, authorize("admin", "staff"), createSmdClosing);
router.get("/smd-closings", authenticate, authorize("admin", "staff"), getSmdClosings);
export default router;
