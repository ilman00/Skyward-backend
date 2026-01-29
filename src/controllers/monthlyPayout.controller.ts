import { Request, Response } from "express";
import { pool } from "../config/db";

export const createMonthlyPayout = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    // 1. Destructure customer_id and smd_id from the body
    const { smd_id, customer_id, payout_month, amount } = req.body;
    const paidBy = req.user!.user_id;
    const role = req.user!.role;

    if (!["admin", "staff"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Updated validation check
    if (!smd_id || !customer_id || !payout_month || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 2. Find the ACTIVE closing ID using smd_id and customer_id
    const closingRes = await client.query(
      `
      SELECT
        sc.smd_closing_id,
        c.status AS customer_status
      FROM smd_closings sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sc.smd_id = $1 
        AND sc.customer_id = $2 
        AND sc.status = 'active'
      LIMIT 1
      `,
      [smd_id, customer_id]
    );

    console.log("After Select ", closingRes.rows);

    if (closingRes.rowCount === 0) {
      // If we find nothing, it means either the ID is wrong or the closing isn't 'active'
      return res.status(404).json({ message: "No active contract found for this SMD and Customer" });
    }

    console.log("After Check ");
    const { smd_closing_id, customer_status } = closingRes.rows[0];

    if (customer_status !== "active") {
      return res.status(400).json({ message: "Customer is not active" });
    }

    // 3. Insert payout using the freshly found smd_closing_id
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

    console.log("After Insert ");
    await client.query("COMMIT");

    console.log(`Monthly payout created for SMD Closing ID: ${smd_closing_id}`);
    res.status(201).json({ message: "Monthly payout recorded successfully" });

  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error(error);



    if (error.code === "23505") {

      return res.status(409).json({

        message: "Payout for this month already exists",

      });
    }

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

export const getRentPayouts = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      status,
      payout_month,
      customer_id,
      smd_id
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const values: any[] = [];
    let whereClause = "WHERE 1=1";

    if (status) {
      values.push(status);
      whereClause += ` AND rp.status = $${values.length}`;
    }

    if (payout_month) {
      values.push(payout_month);
      whereClause += ` AND rp.payout_month = $${values.length}`;
    }

    if (customer_id) {
      values.push(customer_id);
      whereClause += ` AND c.customer_id = $${values.length}`;
    }

    if (smd_id) {
      values.push(smd_id);
      whereClause += ` AND s.smd_id = $${values.length}`;
    }

    const query = `
      SELECT
        rp.payout_id,
        rp.payout_month,
        rp.amount,
        rp.status,
        rp.created_at,
        rp.paid_at,

        c.customer_id,
        cu.full_name AS customer_name,
        cu.email AS customer_email,

        s.smd_id,
        s.smd_code,
        s.title AS smd_title,
        s.city,

        staff.user_id AS paid_by_id,
        staff.full_name AS paid_by_name

      FROM smd_rent_payouts rp
      JOIN smd_closings sc ON sc.smd_closing_id = rp.smd_closing_id
      JOIN customers c ON c.customer_id = sc.customer_id
      JOIN users cu ON cu.user_id = c.user_id
      JOIN smds s ON s.smd_id = sc.smd_id
      LEFT JOIN users staff ON staff.user_id = rp.paid_by
      ${whereClause}
      ORDER BY rp.payout_month DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    values.push(Number(limit), offset);

    const { rows } = await pool.query(query, values);

    res.json({
      page: Number(page),
      limit: Number(limit),
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error("Fetch rent payouts error:", error);
    res.status(500).json({ message: "Failed to fetch rent payouts" });
  }
};
