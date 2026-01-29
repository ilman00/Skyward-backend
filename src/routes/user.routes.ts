import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { getUsers, updateUserByAdmin, softDeleteUser } from "../controllers/user.controller";

const router = express.Router();

router.get("/users", authenticate, authorize("admin"), getUsers);
router.put("/users/:userId", authenticate, authorize("admin"), updateUserByAdmin);
router.delete("/users/:userId", authenticate, authorize("admin"), softDeleteUser);

export default router;

