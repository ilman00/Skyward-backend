import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { addSmd, getSmds, searchSmds, getSmdById, updateSmd, softDeleteSmd, getSMDsByCustomerId } from "../controllers/smd.controller";

const router = express.Router();

router.post("/add-smd", authenticate, authorize("admin", "staff"), addSmd);
router.get("/smds", authenticate, authorize("admin", "staff"), getSmds);
router.get("/smds/search", authenticate, authorize("admin", "staff"), searchSmds);
router.get("/smds/:smdId", authenticate, authorize("admin", "staff"), getSmdById);
router.get("/smds/customer/:customerId", authenticate, authorize("admin", "staff"), getSMDsByCustomerId);
router.put("/smds/:smd_id", authenticate, authorize("admin", "staff"), updateSmd);
router.delete("/smds/:smd_id", authenticate, authorize("admin", "staff"), softDeleteSmd);


export default router;