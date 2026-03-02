import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { getUsers, updateUserByAdmin, softDeleteUser, updateBusinessRoles, getMarketParticipants} from "../controllers/user.controller";

const router = express.Router();

router.get("/staff", authenticate, authorize("admin"), getUsers);
router.put("/users/:userId", authenticate, authorize("admin"), updateUserByAdmin);
router.delete("/users/:userId", authenticate, authorize("admin"), softDeleteUser);
router.put("/users/:userId/business-roles", authenticate, authorize("admin", "staff"), updateBusinessRoles);
router.get("/users/market-participants", authenticate, authorize("admin", "staff"), getMarketParticipants);

export default router;

