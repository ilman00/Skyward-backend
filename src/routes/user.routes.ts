import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { getUsers } from "../controllers/user.controller";

const router = express.Router();

router.get("/users", authenticate, authorize("admin"), getUsers);

export default router;

