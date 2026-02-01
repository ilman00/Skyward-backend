import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

// Fires every time a new client connects
pool.on("connect", () => {
  console.log("✅ PostgreSQL client connected");
});

// Fires on unexpected errors
pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
});

// One-time startup check (MOST IMPORTANT)
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("🚀 PostgreSQL connection verified (query successful)");
  } catch (err) {
    console.error("🔥 PostgreSQL connection FAILED:", err);
  }
})();
