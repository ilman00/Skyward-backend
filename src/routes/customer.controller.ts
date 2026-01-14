import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createCustomer } from "../controllers/customer.controller";

const router = express.Router();

router.post("/create-customer", authenticate, authorize("admin", "staff"), createCustomer);

export default router;