import { Request, Response } from "express";
import { pool } from "../config/db";

export const createSmdClosing = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { customer_id, smds } = req.body;

    const closedBy = req.user!.user_id;
    const role = req.user!.role;

    if (!["admin", "staff"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!customer_id || !Array.isArray(smds) || smds.length === 0) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    await client.query("BEGIN");

    // 1️⃣ Validate customer
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

    const insertedClosings: string[] = [];

    // 2️⃣ Loop each SMD
    for (const smd of smds) {
      const { smd_id, sell_price, monthly_rent, share_percentage } = smd;

      if (!smd_id || !sell_price || !monthly_rent || !share_percentage) {
        throw new Error("Missing SMD fields");
      }

      // Lock SMD row
      const smdRes = await client.query(
        `SELECT smd_id FROM smds WHERE smd_id = $1 FOR UPDATE`,
        [smd_id]
      );

      if (!smdRes.rowCount) {
        throw new Error(`SMD not found: ${smd_id}`);
      }

      // Check current total share
      const shareRes = await client.query(
        `
        SELECT COALESCE(SUM(share_percentage), 0) AS total_share
        FROM smd_closings
        WHERE smd_id = $1
        AND status = 'active'
        `,
        [smd_id]
      );

      const currentShare = Number(shareRes.rows[0].total_share);
      const newShare = Number(share_percentage);

      if (currentShare + newShare > 100) {
        throw new Error(
          `Share exceeds 100% for SMD ${smd_id}. Remaining: ${100 - currentShare}%`
        );
      }

      // Insert closing
      const closingRes = await client.query(
        `
        INSERT INTO smd_closings (
          smd_id,
          customer_id,
          sell_price,
          monthly_rent,
          share_percentage,
          closed_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING smd_closing_id
        `,
        [
          smd_id,
          customer_id,
          sell_price,
          monthly_rent,
          newShare,
          closedBy
        ]
      );

      insertedClosings.push(closingRes.rows[0].smd_closing_id);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "SMD deals closed successfully",
      data: {
        smd_closing_ids: insertedClosings,
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      message: error.message || "Failed to close SMD deals",
    });
  } finally {
    client.release();
  }
};


export const getSmdClosings = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { search } = req.query;
    console.log("Search query:", search);

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];
    let idx = 1;

    /* -----------------------------
       Unified search
       - SMD code
       - Customer name
       - Marketer name
    ------------------------------*/
    if (search) {
      conditions.push(`
        (
          s.smd_code ILIKE $${idx}
          OR u.full_name ILIKE $${idx}
          OR mu.full_name ILIKE $${idx}
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
      LEFT JOIN marketers m ON m.marketer_id = sc.marketer_id
      LEFT JOIN users mu ON mu.user_id = m.user_id
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
        sc.status AS closing_status,
        sc.sell_price,
        sc.monthly_rent,
        sc.created_at,
        sc.closed_at,

        -- smd
        s.smd_id,
        s.smd_code,
        s.city,
        s.area,

        -- customer
        c.customer_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        c.contact_number,

        -- marketer
        m.marketer_id,
        mu.full_name AS marketer_name,
        mu.email AS marketer_email,

        -- closed by
        sc.closed_by,
        cu.full_name AS closed_by_name

      FROM smd_closings sc
      JOIN smds s ON s.smd_id = sc.smd_id
      JOIN customers c ON c.customer_id = sc.customer_id
      JOIN users u ON u.user_id = c.user_id

      LEFT JOIN marketers m ON m.marketer_id = sc.marketer_id
      LEFT JOIN users mu ON mu.user_id = m.user_id
      LEFT JOIN users cu ON cu.user_id = sc.closed_by

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

export const recordClosingPayment = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { smd_closing_id } = req.params;
    const { amount, payment_method, reference_no, notes } = req.body;

    const userId = req.user!.user_id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    await client.query("BEGIN");

    // Insert payment
    await client.query(
      `
      INSERT INTO smd_closing_payments (
        smd_closing_id,
        amount,
        payment_method,
        reference_no,
        notes,
        recorded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [smd_closing_id, amount, payment_method, reference_no, notes, userId]
    );

    // Update totals
    await client.query(
      `
      UPDATE smd_closings
      SET amount_paid = amount_paid + $1,
          updated_at = now()
      WHERE smd_closing_id = $2
      `,
      [amount, smd_closing_id]
    );

    await client.query("COMMIT");

    res.json({ message: "Payment recorded successfully" });

  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
};