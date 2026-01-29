import express from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { getLinkedSmdCustomers, getCustomerSmds } from '../controllers/linkedSmdCustomer.controller';

const router = express.Router();

router.get('/linked-smd-customers', authenticate, authorize('admin', 'staff'), getLinkedSmdCustomers);
router.get('/customers/:customerId/smds', authenticate, authorize('admin', 'staff'), getCustomerSmds);

export default router