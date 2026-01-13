import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { addSmd, getSmds } from "../controllers/smd.controller";

const router = express.Router();

router.post("/add-smd", authenticate, authorize("admin", "staff", "user"), addSmd);
router.get("/smds", authenticate, authorize("admin", "staff", "user"), getSmds);

export default router;