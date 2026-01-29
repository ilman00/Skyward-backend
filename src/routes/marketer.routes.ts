import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createMarketer, getMarketers, searchMarketersByName, updateMarketerCommission, softDeleteMarketer} from "../controllers/marketer.controller";

const router = express.Router();

router.post("/create-marketer", authenticate, authorize("admin", "staff"), createMarketer);
router.get("/marketers", authenticate, authorize("admin", "staff"), getMarketers);
router.get("/marketers/search", authenticate, authorize("admin", "staff"), searchMarketersByName);
router.put("/marketers/:marketerId", authenticate, authorize("admin", "staff"), updateMarketerCommission);
router.delete("/marketers/:marketerId", authenticate, authorize("admin", "staff"), softDeleteMarketer);

export default router;

