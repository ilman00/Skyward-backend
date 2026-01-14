import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config/db";

export const createCustomer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      email,
      password,
      contact_number,
      cnic,
      address,
      city,
    } = req.body;

    const adminId = req.user!.user_id;

    if (!email || !password) {
      return res.status(400).json({
        message: "email and password are required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Check existing user
    const existingUser = await client.query(
      `SELECT 1 FROM users WHERE email = $1`,
      [email]
    );

    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "User with this email already exists",
      });
    }

    // 2️⃣ Get CUSTOMER role id (lowercase role name)
    const roleResult = await client.query(
      `SELECT role_id FROM roles WHERE role_name = 'customer'`
    );

    if (!roleResult.rowCount) {
      throw new Error("Customer role not found");
    }

    const customerRoleId = roleResult.rows[0].role_id;

    // 3️⃣ Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 4️⃣ Create user
    const userResult = await client.query(
      `
      INSERT INTO users (
        email,
        password_hash,
        role_id,
        is_verified
      )
      VALUES ($1, $2, $3, true)
      RETURNING user_id
      `,
      [email, passwordHash, customerRoleId]
    );

    const userId = userResult.rows[0].user_id;

    // 5️⃣ Create customer profile
    await client.query(
      `
      INSERT INTO customers (
        user_id,
        contact_number,
        cnic,
        address,
        city,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        userId,
        contact_number || null,
        cnic || null,
        address || null,
        city || null,
        adminId,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Customer created successfully",
      data: {
        user_id: userId,
        email,
        role: "customer",
        is_verified: true,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      message: "Failed to create customer",
    });
  } finally {
    client.release();
  }
};
