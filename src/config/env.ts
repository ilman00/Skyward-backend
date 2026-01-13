import dotenv from "dotenv";
dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error("❌ Missing JWT_SECRET in environment variables");
}

if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error("❌ Missing JWT_REFRESH_SECRET in environment variables");
}

export const env = {
  pgUser: process.env.PGUSER,
  pgPassword: process.env.PGPASSWORD,
  pgHost: process.env.PGHOST,
  pgPort: Number(process.env.PGPORT),
  pgDatabase: process.env.PGDATABASE,
  serverPort: Number(process.env.PORT) || 5000,

  // ✅ now guaranteed strings
  jwtSecret: process.env.JWT_SECRET as string,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,

  emailUser: process.env.EMAIL_USER,
  emailPass: process.env.EMAIL_PASS,
};
