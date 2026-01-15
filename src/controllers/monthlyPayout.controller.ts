import { Request, Response } from "express";
import { pool } from "../config/db";

export const createMonthlyPayout = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { smd_closing_id, payout_month, amount } = req.body;
    const paidBy = req.user!.user_id;
    const role = req.user!.role;

    if (!["admin", "staff"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!smd_closing_id || !payout_month || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 1️⃣ Validate closing + customer status
    const closingRes = await client.query(
      `
      SELECT
        sc.smd_closing_id,
        c.status AS customer_status
      FROM smd_closings sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sc.smd_closing_id = $1
      `,
      [smd_closing_id]
    );

    if (!closingRes.rowCount) {
      throw new Error("SMD closing not found");
    }

    if (closingRes.rows[0].customer_status !== "active") {
      throw new Error("Customer is not eligible for payout");
    }

    // 2️⃣ Insert payout (unique constraint should exist)
    await client.query(
      `
      INSERT INTO smd_rent_payouts (
        smd_closing_id,
        payout_month,
        amount,
        status,
        paid_by,
        paid_at
      )
      VALUES ($1, $2, $3, 'paid', $4, NOW())
      `,
      [smd_closing_id, payout_month, amount, paidBy]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Monthly payout recorded successfully",
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "Payout for this month already exists",
      });
    }

    res.status(500).json({
      message: error.message || "Failed to create payout",
    });
  } finally {
    client.release();
  }
};



export const getMonthlyPayouts = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { status, smd_closing_id, customer_id, payout_month } = req.query;

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`rp.status = $${idx++}`);
      values.push(status);
    }

    if (smd_closing_id) {
      conditions.push(`rp.smd_closing_id = $${idx++}`);
      values.push(smd_closing_id);
    }

    if (customer_id) {
      conditions.push(`sc.customer_id = $${idx++}`);
      values.push(customer_id);
    }

    if (payout_month) {
      conditions.push(`rp.payout_month = $${idx++}`);
      values.push(payout_month);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    /* -----------------------------
       1️⃣ Count
    ------------------------------*/
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM smd_rent_payouts rp
      JOIN smd_closings sc ON sc.smd_closing_id = rp.smd_closing_id
      ${whereClause}
    `;

    const { rows: countRows } = await client.query(countQuery, values);
    const total = countRows[0].total;

    /* -----------------------------
       2️⃣ Data
    ------------------------------*/
    const dataQuery = `
      SELECT
        rp.payout_id,
        rp.smd_closing_id,
        rp.payout_month,
        rp.amount,
        rp.status,
        rp.paid_at,
        rp.created_at,

        -- customer
        c.customer_id,
        u.email AS customer_email,
        u.full_name AS customer_name,

        -- smd
        s.smd_id,
        s.smd_code,

        -- paid by
        rp.paid_by
      FROM smd_rent_payouts rp
      JOIN smd_closings sc ON sc.smd_closing_id = rp.smd_closing_id
      JOIN customers c ON c.customer_id = sc.customer_id
      JOIN users u ON u.user_id = c.user_id
      JOIN smds s ON s.smd_id = sc.smd_id

      ${whereClause}
      ORDER BY rp.payout_month DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const dataResult = await client.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    res.status(200).json({
      message: "Monthly payouts fetched successfully",
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
      message: "Failed to fetch monthly payouts",
    });
  } finally {
    client.release();
  }
};

