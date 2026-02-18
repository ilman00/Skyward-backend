import express from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { createCustomer, updateCustomer, getAllCustomers, searchCustomersByName, deleteCustomer, newCreateCustomer, getCustomerDetails } from "../controllers/customer.controller";

const router = express.Router();

// router.post("/create-customer", authenticate, authorize("admin", "staff"), createCustomer);
router.post("/customers", authenticate, authorize("admin", "staff"), newCreateCustomer);
router.put("/customers/:userId", authenticate, authorize("admin", "staff"), updateCustomer);
router.get("/customers", authenticate, authorize("admin", "staff"), getAllCustomers);
router.get("/customers/search", authenticate, authorize("admin", "staff"), searchCustomersByName);
router.delete("/customers/:customerId", authenticate, authorize("admin"), deleteCustomer);
router.get("/customers/:id", authenticate, authorize("admin", "staff"), getCustomerDetails);


export default router;