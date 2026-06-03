import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config/db";
import { transporter } from "../config/nodemailer";
import { createAccessToken, createRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { setRefreshCookie } from "../utils/cookies";
import { JwtUser } from "../types/types";

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;


export const registerUser = async (req: Request, res: Response) => {
    // 1. Get a dedicated client from the pool for the transaction
    const client = await pool.connect();

    try {
        const { full_name, email, password } = req.body;

        if (!email || !password || !full_name) {
            return res.status(400).json({ status: 400, message: "All fields are required" });
        }
        console.log("Registering user:", email);
        // --- PRE-CHECK (Outside Transaction) ---
        const existingUser = await client.query("SELECT is_verified FROM users WHERE email = $1", [email]);
        if (existingUser.rowCount! > 0) {
            return res.status(409).json({ status: 409, message: "Email already exists" });
        }
        console.log("No existing user found, proceeding with registration.");
        const roleRow = await client.query("SELECT role_id FROM roles WHERE role_name = 'staff'");
        if (roleRow.rowCount === 0) {
            return res.status(500).json({ status: 500, message: "Default role missing" });
        }

        console.log("Default role found, creating user.");
        const role_id = roleRow.rows[0].role_id;
        const password_hash = await bcrypt.hash(password, 10);

        // --- START TRANSACTION ---
        await client.query('BEGIN');
        console.log("Transaction started.");
        // 🧑 Insert User
        // 🧑 Insert User
        const userResult = await client.query(
            `INSERT INTO users (full_name, email, password_hash, role_id, is_verified, created_at)
            VALUES ($1, $2, $3, $4, false, NOW())
            RETURNING user_id`,
            [full_name, email, password_hash, role_id]
        );

        const user_id = userResult.rows[0].user_id;

        console.log("User inserted into database with id:", user_id);

        // 🔗 Insert into junction table
        await client.query(
            `INSERT INTO user_roles (user_id, role_id)
            VALUES ($1, $2)`,
            [user_id, role_id]
        );

        console.log("User role inserted into junction table.");
        // 🔢 Generate and Insert OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires_at = new Date(Date.now() + 10 * 60 * 1000);
        console.log("OTP generated.");
        await client.query(
            `INSERT INTO otps (email, otp, purpose, expires_at, created_at)
             VALUES ($1, $2, 'register', $3, NOW())`,
            [email, otp, expires_at]
        );

        // 📧 Send Email
        // Note: We do this BEFORE commit because if email fails, we want to rollback the DB changes
        // 1. Generate a plain text version alongside the HTML
        const textContent = `Hello, Your verification code is ${otp}. This code is valid for 10 minutes. If you did not request this, please ignore this email.`;

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Verification Code</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f6f9fc; color: #333333; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    <tr>
                        <td style="padding: 30px 40px 20px 40px; text-align: left; border-bottom: 1px solid #f0f4f8;">
                            <h2 style="font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 0;">Security Verification</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px;">
                            <p style="font-size: 15px; line-height: 24px; color: #555555; margin: 0 0 24px 0;">
                                Hello,
                            </p>
                            <p style="font-size: 15px; line-height: 24px; color: #555555; margin: 0 0 24px 0;">
                                Use the verification code below to complete your login or registration. This code is valid for **10 minutes** and can only be used once.
                            </p>
                            <div style="background-color: #f4f7fa; border-radius: 6px; padding: 16px; text-align: center; margin-bottom: 24px;">
                                <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0052cc; display: inline-block;">${otp}</span>
                            </div>
                            <p style="font-size: 13px; line-height: 20px; color: #888888; margin: 0;">
                                If you didn't request this code, you can safely ignore this email. Someone else may have typed your email address by mistake.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #fafbfc; padding: 20px 40px; text-align: center; border-top: 1px solid #f0f4f8;">
                            <p style="font-size: 12px; color: #aaaaaa; margin: 0;">
                                &copy; ${new Date().getFullYear()} Your Skyward Vision Private Limited. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;

        // 2. Send the updated email structure
        await transporter.sendMail({
            from: `"Your App Security" <${process.env.EMAIL_USER}>`, // Adds a clean sender name alias
            to: email,
            subject: `Your Verification Code: ${otp}`, // Dynamic subjects look less repetitive to spam filters
            text: textContent, // Crucial fallback for spam filters
            html: htmlContent,
        });
        console.log("OTP sent to email.");
        // ✅ If everything passed, COMMIT the changes
        await client.query('COMMIT');
        console.log("Transaction committed.");
        return res.status(200).json({ status: 200, message: "OTP sent to email" });

    } catch (error: any) {
        // ❌ If ANY error occurs, UNDO everything inside the BEGIN block
        await client.query('ROLLBACK');

        console.error("Register error:", error.message);
        return res.status(500).json({ status: 500, message: "Server error", error: error.message });
    } finally {
        // 🚪 Always release the client back to the pool
        client.release();
    }
};


export const loginUser = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const query = `
      SELECT 
  u.user_id,
  u.email,
  u.full_name,
  u.password_hash,
  u.avatar_url,
  u.last_login_at,
  u.is_verified,
  u.status,   -- ⭐ ADD THIS
  r.role_name
FROM users u
JOIN roles r ON u.role_id = r.role_id
WHERE u.email = $1
LIMIT 1
    `;

        const result = await pool.query(query, [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!user.is_verified) {
            return res.status(403).json({
                message: "Account not verified. Please verify your email first.",
                needVerification: true,
                email: user.email,
            });
        }

        if (user.status === "suspended") {
            return res.status(403).json({
                code: "ACCOUNT_SUSPENDED",
                message: "Your account has been suspended. Contact admin."
            });
        }

        if (user.status === "deleted") {
            return res.status(403).json({
                code: "ACCOUNT_DELETED",
                message: "Account no longer exists."
            });
        }


        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        await pool.query(
            `UPDATE users SET last_login_at = NOW() WHERE user_id = $1`,
            [user.user_id]
        );

        const accessToken = createAccessToken({
            user_id: user.user_id,
            email: user.email,
            role: user.role_name,
        });

        const refreshToken = createRefreshToken({
            userId: user.user_id,
        });

        setRefreshCookie(res, refreshToken, REFRESH_TOKEN_EXPIRY_MS);

        return res.status(200).json({
            message: "Login successful",
            user: {
                id: user.user_id,
                full_name: user.full_name,
                email: user.email,
                avatar_url: user.avatar_url,
                role: user.role_name,
            },
            accessToken,
            refreshToken,
        });
    } catch (error: any) {
        console.error("❌ loginUser error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};




export const secureToken = async (req: Request, res: Response) => {

    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ status: 400, message: "Refresh token is required" });
        }

        // Verify the refresh token
        const payload = verifyRefreshToken(refreshToken) as JwtUser;
        if (!payload) {
            return res.status(401).json({ status: 401, message: "Invalid refresh token" });
        }

        setRefreshCookie(res, refreshToken, REFRESH_TOKEN_EXPIRY_MS);

        return res.status(200).json({
            status: 200,
            message: "Refresh token successfully secured in HttpOnly cookie.",
            // The client must discard the token from JS memory after this call.
        });

    } catch (error) {
        console.error("Error in secureToken:", error);
        res.status(500).json({ status: 500, message: "Internal server error" });
    }

}

export const refreshToken = async (req: Request, res: Response) => {
    try {
        // 1. Extract from Cookie (Web) or Body (Mobile)
        const tokenFromRequest = req.cookies?.refreshToken || req.body?.refreshToken;
        if (!tokenFromRequest) {
            return res.status(401).json({ message: "Refresh token missing" });
        }

        // 2. Verify
        const payload: any = verifyRefreshToken(tokenFromRequest);

        // 3. Fetch fresh data (Don't trust old payload data for roles/email)
        const userQuery = `
      SELECT u.email, r.role_name, u.status
FROM users u 
JOIN roles r ON u.role_id = r.role_id 
WHERE u.user_id = $1
    `;
        const userResult = await pool.query(userQuery, [payload.userId]);
        const user = userResult.rows[0];

        if (!user) throw new Error("UserNotFound");

        if (user.status !== "active") {
            return res.status(403).json({
                code: "ACCOUNT_DISABLED",
                message: "Account is not active"
            });
        }

        // 4. Create New Pair
        const newAccessToken = createAccessToken({
            user_id: payload.userId,
            email: user.email,
            role: user.role_name
        });
        const newRefreshToken = createRefreshToken({ userId: payload.userId });

        // 5. Update Cookie for Web
        setRefreshCookie(res, newRefreshToken, REFRESH_TOKEN_EXPIRY_MS);

        // 6. Response for both
        return res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                email: user.email,
                role: user.role_name,
            },
        });

    } catch (error: any) {
        return res.status(401).json({ message: "Session expired. Please log in again." });
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp)
            return res.status(400).json({ message: "Email and OTP are required" });

        // 1. Get latest OTP
        const otpRes = await pool.query(
            `SELECT * FROM otps
       WHERE email = $1 AND purpose = 'register'
       ORDER BY created_at DESC
       LIMIT 1`,
            [email]
        );

        if (otpRes.rows.length === 0)
            return res.status(400).json({ message: "OTP not found" });

        const record = otpRes.rows[0];
        const now = new Date();

        if (record.block_until && new Date(record.block_until) > now) {
            return res.status(429).json({
                message: "Too many attempts. Try again later.",
            });
        }

        if (new Date(record.expires_at) < now) {
            return res.status(400).json({ message: "OTP expired" });
        }

        if (record.otp !== otp.toString()) {
            const newAttempts = record.attempts + 1;

            if (newAttempts >= 5) {
                await pool.query(
                    `UPDATE otps
           SET attempts = $1, block_until = NOW() + INTERVAL '10 minutes'
           WHERE otp_id = $2`,
                    [newAttempts, record.otp_id]
                );

                return res.status(429).json({
                    message: "Too many attempts. You are blocked for 10 minutes.",
                });
            }

            await pool.query(
                `UPDATE otps SET attempts = attempts + 1 WHERE otp_id = $1`,
                [record.otp_id]
            );

            return res.status(400).json({ message: "Invalid OTP" });
        }

        // 2. Verify user
        await pool.query(
            `UPDATE users SET is_verified = true WHERE email = $1`,
            [email]
        );

        // 3. Fetch FULL user (important)
        const userRes = await pool.query(
            `
      SELECT 
        u.user_id,
        u.email,
        r.role_name
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      WHERE u.email = $1
      LIMIT 1
      `,
            [email]
        );

        const user = userRes.rows[0];

        if (!user) {
            return res.status(404).json({ message: "User not found after verification" });
        }

        // 4. Delete OTPs
        await pool.query(
            `DELETE FROM otps WHERE email = $1 AND purpose = 'register'`,
            [email]
        );

        // 5. Generate tokens (SAME structure as login)
        const accessToken = createAccessToken({
            user_id: user.user_id,
            email: user.email,
            role: user.role_name,
        });

        const refreshToken = createRefreshToken({
            userId: user.user_id,
        });

        return res.status(200).json({
            message: "Account verified successfully",
            accessToken,
            refreshToken,
        });

    } catch (error: any) {
        console.error("❌ verifyOtp error:", error);
        res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};

export const resendOtp = async (req: Request, res: Response) => {
    try {
        const { email, purpose } = req.body;

        if (!email || !purpose) {
            return res.status(400).json({
                message: "Email and purpose are required"
            });
        }

        // Validate purpose against DB constraint
        if (!["register", "reset_password"].includes(purpose)) {
            return res.status(400).json({
                message: "Invalid OTP purpose"
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const now = new Date();

        const otpRes = await pool.query(
            `
      SELECT *
      FROM otps
      WHERE email = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
            [normalizedEmail, purpose]
        );

        const record = otpRes.rows[0];

        // Block check
        if (record?.block_until && new Date(record.block_until) > now) {
            return res.status(429).json({
                message: "Too many requests. Try again later."
            });
        }

        // 1 minute cooldown
        if (
            record?.last_sent &&
            now.getTime() - new Date(record.last_sent).getTime() < 60_000
        ) {
            return res.status(429).json({
                message: "OTP already sent. Please wait 1 minute."
            });
        }

        // Max 5 resends → block 1 hour
        if (record && record.resend_count >= 5) {
            await pool.query(
                `
        UPDATE otps
        SET block_until = NOW() + INTERVAL '1 hour'
        WHERE otp_id = $1
        `,
                [record.otp_id]
            );

            return res.status(429).json({
                message: "Too many OTP requests. Try again in 1 hour."
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        if (record) {
            await pool.query(
                `
        UPDATE otps
        SET otp = $1,
            expires_at = NOW() + INTERVAL '10 minutes',
            resend_count = resend_count + 1,
            last_sent = NOW(),
            attempts = 0,
            block_until = NULL
        WHERE otp_id = $2
        `,
                [otp, record.otp_id]
            );
        } else {
            await pool.query(
                `
        INSERT INTO otps (email, otp, purpose, expires_at, resend_count, last_sent)
        VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', 1, NOW())
        `,
                [normalizedEmail, otp, purpose]
            );
        }

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: normalizedEmail,
            subject:
                purpose === "register"
                    ? "Your Registration OTP"
                    : "Your Password Reset OTP",
            html: `<p>Your OTP code is <b>${otp}</b>. It expires in 10 minutes.</p>`
        });

        return res.status(200).json({
            message: "OTP sent successfully"
        });

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }
};