import { Request, Response } from "express";
import {pool} from "../config/db";

export const createSmdClosing = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      smd_id,
      customer_id,
      marketer_id,
      sell_price,
      monthly_rent
    } = req.body;

    const closedBy = req.user!.user_id;
    const role = req.user!.role;

    if (!["admin", "staff"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!smd_id || !customer_id || !sell_price || !monthly_rent) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 1️⃣ Lock SMD
    const smdRes = await client.query(
      `SELECT smd_id FROM smds WHERE smd_id = $1 FOR UPDATE`,
      [smd_id]
    );

    if (!smdRes.rowCount) {
      throw new Error("SMD not found");
    }

    // 2️⃣ Check if SMD already sold (active contract)
    const existingClosing = await client.query(
      `SELECT 1 FROM smd_closings WHERE smd_id = $1`,
      [smd_id]
    );

    if (existingClosing.rowCount) {
      return res.status(409).json({
        message: "SMD already has a contract",
      });
    }

    // 3️⃣ Validate customer
    const customerRes = await client.query(
      `
      SELECT c.customer_id
      FROM customers c
      JOIN users u ON u.user_id = c.user_id
      WHERE c.customer_id = $1
        AND u.status = 'active'
        AND c.status = 'active'
      `,
      [customer_id]
    );

    if (!customerRes.rowCount) {
      throw new Error("Customer not eligible");
    }

    // 4️⃣ Validate marketer (optional)
    if (marketer_id) {
      const marketerRes = await client.query(
        `
        SELECT 1
        FROM marketers m
        JOIN users u ON u.user_id = m.user_id
        WHERE m.marketer_id = $1
          AND m.status = 'active'
        `,
        [marketer_id]
      );

      if (!marketerRes.rowCount) {
        throw new Error("Invalid marketer");
      }
    }

    // 5️⃣ Insert closing
    const closingRes = await client.query(
      `
      INSERT INTO smd_closings (
        smd_id,
        customer_id,
        marketer_id,
        sell_price,
        monthly_rent,
        closed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING smd_closing_id
      `,
      [
        smd_id,
        customer_id,
        marketer_id || null,
        sell_price,
        monthly_rent,
        closedBy
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "SMD contract closed successfully",
      data: {
        smd_closing_id: closingRes.rows[0].smd_closing_id,
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      message: error.message || "Failed to close SMD",
    });
  } finally {
    client.release();
  }
};



export const getSmdClosings = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { customer_id, smd_id, marketer_id, search } = req.query;

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];
    let idx = 1;

    if (customer_id) {
      conditions.push(`sc.customer_id = $${idx++}`);
      values.push(customer_id);
    }

    if (smd_id) {
      conditions.push(`sc.smd_id = $${idx++}`);
      values.push(smd_id);
    }

    if (marketer_id) {
      conditions.push(`sc.marketer_id = $${idx++}`);
      values.push(marketer_id);
    }

    if (search) {
      conditions.push(`
        (
          u.email ILIKE $${idx}
          OR u.full_name ILIKE $${idx}
          OR s.smd_code ILIKE $${idx}
        )
      `);
      values.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    /* -----------------------------
       1️⃣ Count
    ------------------------------*/
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM smd_closings sc
      JOIN customers c ON c.customer_id = sc.customer_id
      JOIN users u ON u.user_id = c.user_id
      JOIN smds s ON s.smd_id = sc.smd_id
      ${whereClause}
    `;

    const { rows: countRows } = await client.query(countQuery, values);
    const total = countRows[0].total;

    /* -----------------------------
       2️⃣ Data
    ------------------------------*/
    const dataQuery = `
      SELECT
        sc.smd_closing_id,
        sc.smd_id,
        s.smd_code,
        s.city,
        s.area,

        sc.sell_price,
        sc.monthly_rent,
        sc.created_at,

        -- customer
        c.customer_id,
        u.email AS customer_email,
        u.full_name AS customer_name,

        -- marketer
        m.marketer_id,
        mu.email AS marketer_email,

        -- closed by
        sc.closed_by
      FROM smd_closings sc
      JOIN smds s ON s.smd_id = sc.smd_id
      JOIN customers c ON c.customer_id = sc.customer_id
      JOIN users u ON u.user_id = c.user_id

      LEFT JOIN marketers m ON m.marketer_id = sc.marketer_id
      LEFT JOIN users mu ON mu.user_id = m.user_id

      ${whereClause}
      ORDER BY sc.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const dataResult = await client.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    res.status(200).json({
      message: "SMD closings fetched successfully",
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch SMD closings",
    });
  } finally {
    client.release();
  }
};
