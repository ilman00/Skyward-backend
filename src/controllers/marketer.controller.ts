import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { pool } from "../config/db";

export const createMarketer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      email,
      full_name,
      password,
      commission_type = "percentage",
      commission_value,
    } = req.body;

    const adminId = req.user!.user_id;

    if (!email || !full_name || !password || !commission_value) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Check if user already exists
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

    // 2️⃣ Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 3️⃣ Get MARKETER role id
    const roleResult = await client.query(
      `SELECT role_id FROM roles WHERE role_name = 'marketer'`
    );

    if (!roleResult.rowCount) {
      throw new Error("MARKETER role not found");
    }

    const marketerRoleId = roleResult.rows[0].role_id;

    // 4️⃣ Create user
    const userResult = await client.query(
      `
      INSERT INTO users (
        email,
        full_name,
        password_hash,
        role_id,
        is_verified
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING user_id
      `,
      [email, full_name, passwordHash, marketerRoleId]
    );

    const userId = userResult.rows[0].user_id;

    // 5️⃣ Create marketer profile
    await client.query(
      `
      INSERT INTO marketers (
        user_id,
        commission_type,
        commission_value,
        created_by
      )
      VALUES ($1, $2, $3, $4)
      `,
      [userId, commission_type, commission_value, adminId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Marketer created successfully",
      data: {
        user_id: userId,
        email,
        full_name,
        commission_type,
        commission_value,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    return res.status(500).json({
      message: "Failed to create marketer",
    });
  } finally {
    client.release();
  }
};


export const getMarketers = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      email,
      commission_type,
      created_by,
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.max(Number(limit), 1);
    const offset = (pageNumber - 1) * pageSize;

    let baseQuery = `
      FROM marketers m
      JOIN users u ON u.user_id = m.user_id
      JOIN users admin ON admin.user_id = m.created_by
      WHERE 1=1
    `;

    const values: any[] = [];
    let index = 1;

    if (email) {
      baseQuery += ` AND u.email ILIKE $${index++}`;
      values.push(`%${email}%`);
    }

    if (commission_type) {
      baseQuery += ` AND m.commission_type = $${index++}`;
      values.push(commission_type);
    }

    if (created_by) {
      baseQuery += ` AND m.created_by = $${index++}`;
      values.push(created_by);
    }

    // total count
    const countResult = await pool.query(
      `SELECT COUNT(*) ${baseQuery}`,
      values
    );
    const total = Number(countResult.rows[0].count);

    // data
    const dataQuery = `
      SELECT
        m.marketer_id,
        m.commission_type,
        m.commission_value,
        m.status,
        m.created_at,
        u.user_id,
        u.email,
        u.full_name,
        admin.full_name AS created_by_name,
        admin.email AS created_by_email
      ${baseQuery}
      ORDER BY m.created_at DESC
      LIMIT $${index++} OFFSET $${index++}
    `;

    values.push(pageSize, offset);

    const { rows } = await pool.query(dataQuery, values);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch marketers",
    });
  }
};
