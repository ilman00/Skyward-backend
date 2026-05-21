import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { checkInVisitor, updateVisitor, getVisitors, deleteVisitor } from "../controllers/reception.controller";

const router = Router();

router.use(authenticate, authorize("admin", "staff"));

router.get("/visitors", getVisitors);
router.post("/visitors", checkInVisitor);
router.patch("/visitors/:id", updateVisitor);
router.delete("/visitors/:id", deleteVisitor);

export default router;