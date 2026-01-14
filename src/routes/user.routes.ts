import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { getUsers, updateUserByAdmin } from "../controllers/user.controller";

const router = express.Router();

router.get("/users", authenticate, authorize("admin"), getUsers);
router.put("/users/:userId", authenticate, authorize("admin"), updateUserByAdmin);

export default router;

