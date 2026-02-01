import { CorsOptions } from "cors";

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://software.skywardvision.com.pk",
  "https://skywardvision.com.pk",
  "https://www.skywardvision.com.pk"

];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server, Postman, etc.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false); // ❌ silently block (no CORS crash)
  },
  credentials: true, // ✅ REQUIRED for cookies
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

export default corsOptions;
