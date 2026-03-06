import express from "express"
import { recordClosingPayment, getClosingBalance } from "../controllers/smdPayment.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

const router = express.Router();

router.post("/record-payment", authenticate, authorize("admin", "staff"), recordClosingPayment);
router.get("/closing-balance", authenticate, authorize("admin", "staff"), getClosingBalance);

export default router;