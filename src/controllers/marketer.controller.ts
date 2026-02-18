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
      WHERE 1=1 AND m.status = 'active'
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

// controllers/marketer.controller.ts
export const searchMarketersByName = async (req: Request, res: Response) => {
  // 1. Default to empty string to allow initial loading
  const q = req.query.q as string || "";

  try {
    // 2. Remove the q.length < 2 block and use conditional WHERE logic
    const queryText = `
      SELECT 
        m.marketer_id,
        u.full_name
      FROM marketers m
      JOIN users u ON u.user_id = m.user_id
      WHERE m.status = 'active'
        ${q ? "AND u.full_name ILIKE '%' || $1 || '%'" : ""}
      ORDER BY u.full_name
      LIMIT 10
    `;

    const values = q ? [q] : [];
    const { rows } = await pool.query(queryText, values);

    // 3. Return raw rows for frontend mapping
    res.status(200).json(rows);
  } catch (error) {
    console.error("Marketer Search Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const softDeleteMarketer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { marketerId } = req.params;

    if (!marketerId) {
      return res.status(400).json({
        message: "Marketer ID is required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Get marketer & linked user
    const marketerResult = await client.query(
      `
      SELECT m.marketer_id, u.user_id
      FROM marketers m
      JOIN users u ON u.user_id = m.user_id
      WHERE m.marketer_id = $1
        AND m.status != 'deleted'
      `,
      [marketerId]
    );

    if (!marketerResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Marketer not found or already deleted",
      });
    }

    const { user_id } = marketerResult.rows[0];

    // 2️⃣ Soft delete marketer
    await client.query(
      `
      UPDATE marketers
      SET status = 'deleted'
      WHERE marketer_id = $1
      `,
      [marketerId]
    );

    // 3️⃣ Soft delete user
    await client.query(
      `
      UPDATE users
      SET status = 'deleted',
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      `,
      [user_id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Marketer deleted successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    return res.status(500).json({
      message: "Failed to delete marketer",
    });
  } finally {
    client.release();
  }
};


export const updateMarketerCommission = async (
  req: Request,
  res: Response
) => {
  const client = await pool.connect();

  try {
    const { marketerId } = req.params;
    const { commission_type, commission_value } = req.body;

    if (!marketerId) {
      return res.status(400).json({
        message: "Marketer ID is required",
      });
    }

    if (
      commission_type === undefined &&
      commission_value === undefined
    ) {
      return res.status(400).json({
        message: "Nothing to update",
      });
    }

    // Optional validations
    if (
      commission_type &&
      !["percentage", "fixed"].includes(commission_type)
    ) {
      return res.status(400).json({
        message: "Invalid commission type",
      });
    }

    if (
      commission_value !== undefined &&
      (isNaN(commission_value) || commission_value <= 0)
    ) {
      return res.status(400).json({
        message: "Invalid commission value",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Check marketer exists & active
    const marketerCheck = await client.query(
      `
      SELECT marketer_id
      FROM marketers
      WHERE marketer_id = $1
        AND status != 'deleted'
      `,
      [marketerId]
    );

    if (!marketerCheck.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Marketer not found or deleted",
      });
    }

    // 2️⃣ Build dynamic update
    const fields: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (commission_type !== undefined) {
      fields.push(`commission_type = $${index++}`);
      values.push(commission_type);
    }

    if (commission_value !== undefined) {
      fields.push(`commission_value = $${index++}`);
      values.push(commission_value);
    }

    values.push(marketerId);

    const updateQuery = `
      UPDATE marketers
      SET ${fields.join(", ")}
      WHERE marketer_id = $${index}
    `;

    await client.query(updateQuery, values);

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Commission updated successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    return res.status(500).json({
      message: "Failed to update commission",
    });
  } finally {
    client.release();
  }
};



