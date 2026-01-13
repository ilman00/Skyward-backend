
import { Request, Response } from "express";
import { pool } from "../config/db";
import { transporter } from "../config/nodemailer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createAccessToken, createRefreshToken } from "../utils/jwt";


export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check user exists
    const userRes = await pool.query(
      "SELECT user_id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2. Check existing OTP
    const existingOtpRes = await pool.query(
      `
      SELECT * FROM otps
      WHERE email = $1 AND purpose = 'reset_password'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (existingOtpRes.rows.length > 0) {
      const otpRow = existingOtpRes.rows[0];

      // Block check
      if (otpRow.block_until && new Date(otpRow.block_until) > new Date()) {
        return res.status(429).json({
          message: "Too many requests. Please try later."
        });
      }

      // Resend limit example
      if (otpRow.resend_count >= 5) {
        await pool.query(
          `UPDATE otps SET block_until = NOW() + INTERVAL '15 minutes' WHERE otp_id = $1`,
          [otpRow.otp_id]
        );
        return res.status(429).json({
          message: "OTP resend limit reached. Try again later."
        });
      }
    }

    // 3. Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 4. Upsert OTP
    await pool.query(
      `
      INSERT INTO otps (email, otp, purpose, expires_at)
      VALUES ($1, $2, 'reset_password', $3)
      ON CONFLICT (email, purpose)
      DO UPDATE SET
        otp = EXCLUDED.otp,
        expires_at = EXCLUDED.expires_at,
        resend_count = otps.resend_count + 1,
        last_sent = NOW(),
        attempts = 0,
        block_until = NULL
      `,
      [normalizedEmail, otp, expiresAt]
    );

    // 5. Send email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: normalizedEmail,
      subject: "Password Reset OTP",
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
    });

    return res.status(200).json({ message: "OTP sent to email" });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};



export const verifyForgotOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const otpRes = await pool.query(
      `
      SELECT *
      FROM otps
      WHERE email = $1 AND purpose = 'reset_password'
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: "OTP not found" });
    }

    const record = otpRes.rows[0];

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    if (record.otp !== String(otp)) {
      await pool.query(
        `UPDATE otps SET attempts = attempts + 1 WHERE otp_id = $1`,
        [record.otp_id]
      );
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // OTP valid → delete OTP
    await pool.query(
      `DELETE FROM otps WHERE email = $1 AND purpose = 'reset_password'`,
      [normalizedEmail]
    );

    // 🔑 Issue RESET JWT
    const resetToken = jwt.sign(
      {
        email: normalizedEmail,
        purpose: "reset_password"
      },
      process.env.JWT_SECRET!,
      { expiresIn: "10m" }
    );

    return res.status(200).json({
      message: "OTP verified",
      resetToken
    });

  } catch (error: any) {
    return res.status(500).json({ message: "Server error" });
  }
};


export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { newPassword, resetToken } = req.body;

    if (!newPassword || !resetToken) {
      return res.status(400).json({
        message: "New password and reset token required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long"
      });
    }

    // 1. Verify JWT
    let payload: any;
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET!);
    } catch {
      return res.status(401).json({
        message: "Invalid or expired reset token"
      });
    }

    if (payload.purpose !== "reset_password" || !payload.email) {
      return res.status(401).json({
        message: "Invalid reset token"
      });
    }

    const normalizedEmail = payload.email;

    // 2. Update password
    const hash = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          updated_at = NOW()
      WHERE email = $2
      `,
      [hash, normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Password reset successful"
    });

  } catch (error: any) {
    return res.status(500).json({ message: "Server error" });
  }
};

