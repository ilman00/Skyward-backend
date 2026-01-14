import express from "express";
import authRoutes from "./routes/auth.routes";
import smdRoutes from "./routes/smd.routes";
import marketerRoutes from "./routes/marketer.routes";
import customerRoutes from "./routes/customer.controller";
const app = express();

app.use(express.json());


app.use("/api/auth", authRoutes);
app.use("/api", smdRoutes);
app.use("/api", marketerRoutes);
app.use("/api", customerRoutes);

app.use(express.json());

export default app;
