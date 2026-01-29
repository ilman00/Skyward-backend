import dotenv from "dotenv";
import path from "path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import corsOptions from "./config/cors";

import authRoutes from "./routes/auth.routes";
import smdRoutes from "./routes/smd.routes";
import marketerRoutes from "./routes/marketer.routes";
import customerRoutes from "./routes/customer.controller";
import monthlyPayoutRoutes from "./routes/monthlyPayout.controller";
import smdClosingRoutes from "./routes/smdClosing.routes";
import linkedSmdCustomerRoutes from "./routes/linkedSmdCustomer";
import userRoutes from "./routes/user.routes";

dotenv.config();

export const app = express();

// ✅ Middleware order matters
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

// ✅ Static uploads
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api", smdRoutes);
app.use("/api", marketerRoutes);
app.use("/api", customerRoutes);
app.use("/api", monthlyPayoutRoutes);
app.use("/api", smdClosingRoutes);
app.use("/api", linkedSmdCustomerRoutes);
app.use("/api", userRoutes);

export default app;
