import { Router } from "express";
import { generateDealPDF } from "../controllers/pdf.controller";

const router = Router();

router.get("/preview-deal/:deal_id", generateDealPDF);

export default router;