import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createMarketer } from "../controllers/marketer.controller";

const router = express.Router();

router.post("/create-marketer", authenticate, authorize("admin", "staff"), createMarketer);

export default router;

