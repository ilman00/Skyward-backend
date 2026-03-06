import { Request, Response } from "express";
import { pool } from "../config/db"; // adjust to your pg pool path

// ---------------------------------------------------------------------------
// Helper — resolves marketer_id from the authenticated user's user_id.
// Your auth middleware should attach `req.user` with at least { user_id }.
// ---------------------------------------------------------------------------
async function resolveMarketerId(userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT m.marketer_id
     FROM marketers m
     WHERE m.user_id = $1
       AND m.status = 'active'
     LIMIT 1`,
    [userId]
  );

  console.log("resolveMarketerId query result:", result.rows);
  return result.rows[0]?.marketer_id ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/marketers/dashboard/summary
//
// No params needed — identity is resolved from the auth token.
//s
// Response:
//  {
//    total_customers        : number,
//    total_smds_bought      : number,
//    total_commission_earned: number,
//    unpaid_commission      : number
//  }
// ---------------------------------------------------------------------------
export const getMarketerDashboardSummary = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id; // set by your auth middleware
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized." });
      return;
    }

    console.log("Authenticated userId:", userId);
    const marketerId = await resolveMarketerId(userId);
    console.log("Resolved marketerId:", marketerId);
    if (!marketerId) {
      res.status(404).json({ success: false, message: "Marketer profile not found." });
      return;
    }

    const { rows } = await pool.query(
      `SELECT
         COUNT(DISTINCT c.customer_id)                           AS total_customers,
         COUNT(DISTINCT sc.smd_closing_id)                       AS total_smds_bought,
         COALESCE(SUM(mc.amount), 0)                             AS total_commission_earned,
         COALESCE(
           SUM(mc.amount) FILTER (WHERE mc.status = 'pending'),
           0
         )                                                       AS unpaid_commission

       FROM marketers m

       LEFT JOIN customers c
         ON c.marketer_id = m.marketer_id
         AND c.status != 'deleted'

       LEFT JOIN smd_closings sc
         ON sc.marketer_id = m.marketer_id
         AND sc.customer_id = c.customer_id

       LEFT JOIN marketer_commissions mc
         ON mc.marketer_id = m.marketer_id

       WHERE m.marketer_id = $1`,
      [marketerId]
    );

    const row = rows[0];

    res.status(200).json({
      success: true,
      data: {
        total_customers: Number(row.total_customers),
        total_smds_bought: Number(row.total_smds_bought),
        total_commission_earned: Number(row.total_commission_earned),
        unpaid_commission: Number(row.unpaid_commission),
      },
    });
  } catch (error) {
    console.error("getMarketerDashboardSummary error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ---------------------------------------------------------------------------
// GET /api/marketers/dashboard/clients
//
// No params needed — identity is resolved from the auth token.
//
// Query params:
//   page   {number}  default 1
//   limit  {number}  default 10, max 100
//   search {string}  optional — filters by customer name or email
//
// Response:
//  {
//    data: [{
//      customer_id, customer_name, email, contact_number,
//      city, cnic, customer_status, joined_at,
//      total_smds, total_investment, total_rent_earned
//    }],
//    pagination: { total, page, limit, total_pages }
//  }
// ---------------------------------------------------------------------------
export const getMarketerClients = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized." });
      return;
    }

    const marketerId = await resolveMarketerId(userId);
    if (!marketerId) {
      res.status(404).json({ success: false, message: "Marketer profile not found." });
      return;
    }

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;
    const search = (req.query.search as string)?.trim() || "";

    // ── Count query ──────────────────────────────────────────────────────────
    const countQuery = `
      SELECT COUNT(DISTINCT c.customer_id) AS total
      FROM customers c
      JOIN users u ON u.user_id = c.user_id
      WHERE c.marketer_id = $1
        AND c.status != 'deleted'
        ${search ? "AND (u.full_name ILIKE $2 OR u.email ILIKE $2)" : ""}
    `;
    const countValues: unknown[] = search
      ? [marketerId, `%${search}%`]
      : [marketerId];

    const countResult = await pool.query(countQuery, countValues);
    const total = Number(countResult.rows[0]?.total ?? 0);

    // ── Data query ───────────────────────────────────────────────────────────
    const dataQuery = `
      SELECT
        c.customer_id,
        u.full_name                                               AS customer_name,
        u.email,
        COALESCE(c.phone_number, c.contact_number)               AS contact_number,
        c.city,
        c.cnic,
        c.status                                                  AS customer_status,
        c.created_at                                              AS joined_at,

        COUNT(DISTINCT sc.smd_closing_id)                         AS total_smds,
        COALESCE(SUM(sc.sell_price), 0)                           AS total_investment,
        COALESCE(
          SUM(srp.amount) FILTER (WHERE srp.status = 'paid'),
          0
        )                                                         AS total_rent_earned

      FROM customers c
      JOIN users u
        ON u.user_id = c.user_id

      LEFT JOIN smd_closings sc
        ON sc.customer_id = c.customer_id
        AND sc.marketer_id = $1

      LEFT JOIN smd_rent_payouts srp
        ON srp.smd_closing_id = sc.smd_closing_id

      WHERE c.marketer_id = $1
        AND c.status != 'deleted'
        ${search ? "AND (u.full_name ILIKE $2 OR u.email ILIKE $2)" : ""}

      GROUP BY
        c.customer_id,
        u.full_name,
        u.email,
        c.phone_number,
        c.contact_number,
        c.city,
        c.cnic,
        c.status,
        c.created_at

      ORDER BY c.created_at DESC
      LIMIT $${search ? 3 : 2} OFFSET $${search ? 4 : 3}
    `;
    const dataValues: unknown[] = search
      ? [marketerId, `%${search}%`, limit, offset]
      : [marketerId, limit, offset];

    const { rows } = await pool.query(dataQuery, dataValues);

    res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        customer_id:      row.customer_id,
        customer_name:    row.customer_name,
        email:            row.email,
        contact_number:   row.contact_number,
        city:             row.city,
        cnic:             row.cnic,
        customer_status:  row.customer_status,
        joined_at:        row.joined_at,
        total_smds:       Number(row.total_smds),
        total_investment: Number(row.total_investment),
        total_rent_earned: Number(row.total_rent_earned),
      })),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getMarketerClients error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};