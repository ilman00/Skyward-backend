import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createCustomer, updateCustomer, getAllCustomers } from "../controllers/customer.controller";

const router = express.Router();

router.post("/create-customer", authenticate, authorize("admin", "staff"), createCustomer);
router.put("/customers/:userId", authenticate, authorize("admin", "staff"), updateCustomer);
router.get("/customers", authenticate, authorize("admin", "staff"), getAllCustomers);

export default router;