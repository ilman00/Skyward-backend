import express from "express";
import authRoutes from "./routes/auth.routes";
import smdRoutes from "./routes/smd.routes";
import marketerRoutes from "./routes/marketer.routes";
import customerRoutes from "./routes/customer.controller";
import monthlyPayoutRoutes from "./routes/monthlyPayout.controller";
import smdClosingRoutes from "./routes/smdClosing.routes";

const app = express();

app.use(express.json());


app.use("/api/auth", authRoutes);
app.use("/api", smdRoutes);
app.use("/api", marketerRoutes);
app.use("/api", customerRoutes);
app.use("/api", monthlyPayoutRoutes);
app.use("/api", smdClosingRoutes);

app.use(express.json());

export default app;
