import expres from "express";
import { getDeals, getDealById } from "../controllers/smdDeals.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

const router = expres.Router();

router.get("/deals", authenticate, authorize("admin", "staff"), getDeals);
router.get("/deals/:deal_id", authenticate, authorize("admin", "staff"), getDealById);

export default router;