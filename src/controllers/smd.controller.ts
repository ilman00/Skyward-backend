import { Request, Response } from "express";
import { pool } from "../config/db";

export const addSmd = async (req: Request, res: Response) => {
  try {
    const { smd_code, title, purchase_price } = req.body;
    const addedBy = (req as any).user.user_id;

    if (!smd_code) {
      return res.status(400).json({
        message: "smd_code is required"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO smds (
        smd_code,
        title,
        purchase_price,
        added_by,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $4)
      RETURNING *
      `,
      [
        smd_code,
        title || null,
        purchase_price || 0,
        addedBy
      ]
    );

    return res.status(201).json({
      message: "SMD created successfully",
      smd: result.rows[0]
    });

  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "SMD with this code already exists"
      });
    }

    console.error("Add SMD error:", error);
    return res.status(500).json({
      message: "Server error"
    });
  }
};




export const getSmds = async (req: Request, res: Response) => {
  try {
    const {
      status,
      city,
      is_active,
      owner_user_id,
      search,
      page = "1",
      limit = "10",
    } = req.query;

    const pageNumber = Math.max(parseInt(page as string, 10), 1);
    const pageSize = Math.max(parseInt(limit as string, 10), 1);
    const offset = (pageNumber - 1) * pageSize;

    let baseQuery = `
  FROM smds
  WHERE is_active = true
    AND status != 'removed'
`;

    const values: any[] = [];
    let index = 1;

    if (status) {
      baseQuery += ` AND status = $${index++}`;
      values.push(status);
    }

    if (city) {
      baseQuery += ` AND city = $${index++}`;
      values.push(city);
    }

    if (is_active !== undefined) {
      baseQuery += ` AND is_active = $${index++}`;
      values.push(is_active === "true");
    }

    if (owner_user_id) {
      baseQuery += ` AND owner_user_id = $${index++}`;
      values.push(owner_user_id);
    }

    if (search) {
      baseQuery += ` AND smd_code ILIKE $${index++}`;
      values.push(`%${search}%`);
    }

    // Total count
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Data query
    const dataQuery = `
      SELECT *
      ${baseQuery}
      ORDER BY created_at DESC
      LIMIT $${index++}
      OFFSET $${index++}
    `;

    values.push(pageSize, offset);

    const { rows } = await pool.query(dataQuery, values);

    return res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: rows,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to fetch SMDs",
    });
  }
};

// controllers/smd.controller.ts
// controllers/smd.controller.ts
export const searchSmds = async (req: Request, res: Response) => {
  // 1. Handle empty query by defaulting to an empty string
  const q = req.query.q as string || "";

  try {
    // 2. Build query: If q is empty, we skip the ILIKE filter to show default results
    const queryText = `
      SELECT smd_id, smd_code
      FROM smds
      WHERE is_active = true
        AND status = 'active'
        ${q ? "AND smd_code ILIKE '%' || $1 || '%'" : ""}
      ORDER BY smd_code
      LIMIT 10
    `;

    const values = q ? [q] : [];
    const { rows } = await pool.query(queryText, values);

    // 3. Return raw rows (mapping happens on your frontend service)
    res.status(200).json(rows);
  } catch (error) {
    console.error("SMD Search Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


export const getSmdById = async (req: Request, res: Response) => {
  const { smdId } = req.params;
  console.log("Get SMD by ID params:", smdId);

  if (!smdId) {
    return res
      .status(400)
      .json({ status: 400, message: "SMD ID is required" });
  }

  const client = await pool.connect();

  try {
    const query = `
      SELECT
        s.smd_id,
        s.smd_code,
        s.installed_at,
        s.address,
        s.purchase_price,
        s.sell_price,
        s.monthly_payout,

        owner.full_name AS owner_name,
        added_by.full_name AS added_by_name,
        marketer_user.full_name AS marketer_name

      FROM smds s

      LEFT JOIN users owner
        ON owner.user_id = s.owner_user_id

      INNER JOIN users added_by
        ON added_by.user_id = s.added_by

      LEFT JOIN marketers m
        ON m.marketer_id = s.marketer_id

      LEFT JOIN users marketer_user
        ON marketer_user.user_id = m.user_id

      WHERE s.smd_id = $1
    `;

    const { rows } = await client.query(query, [smdId]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ status: 404, message: "SMD not found" });
    }

    console.log("Get SMD by ID result:", rows[0]);
    return res.status(200).json({
      status: 200,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get SMD by ID error:", error);
    return res
      .status(500)
      .json({ status: 500, message: "Internal server error" });
  } finally {
    client.release();
  }
};

export const getSMDsByCustomerId = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({ message: "customerId is required" });
    }

    const query = `
      SELECT
        sc.smd_closing_id,
        sc.customer_id,
        sc.status AS closing_status,
        sc.monthly_rent,
        sc.sell_price,
        sc.total_amount_due,
        sc.amount_paid,
        sc.remaining_balance,
        sc.share_percentage,
        sc.closed_at,

        s.smd_id,
        s.smd_code,
        s.title,
        s.city,
        s.area,
        s.address,
        s.status AS smd_status,
        s.monthly_payout,
        s.sell_price AS smd_sell_price,
        s.installed_at

      FROM smd_closings sc
      JOIN smds s ON s.smd_id = sc.smd_id
      WHERE sc.customer_id = $1
      ORDER BY sc.closed_at DESC
    `;

    const result = await client.query(query, [customerId]);

    res.status(200).json({
      message: "Customer SMDs fetched successfully",
      count: result.rows.length,
      data: result.rows,
    });

  } catch (error) {
    console.error("❌ getSMDsByCustomerId error:", error);
    res.status(500).json({ message: "Failed to fetch SMDs" });
  } finally {
    client.release();
  }
};


export const updateSmd = async (req: Request, res: Response) => {
  const { smd_id } = req.params;

  const {
    smd_code,
    address,
    installed_at,
    purchase_price,
    sell_price,
    monthly_payout,
  } = req.body;

  if (!smd_id) {
    return res.status(400).json({ message: "smd_id is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE public.smds
SET
  smd_code        = COALESCE(NULLIF($1, ''), smd_code),
  address         = COALESCE(NULLIF($2, ''), address),
  installed_at    = COALESCE($3, installed_at),
  purchase_price  = COALESCE(NULLIF($4, '')::numeric, purchase_price),
  sell_price      = COALESCE(NULLIF($5, '')::numeric, sell_price),
  monthly_payout  = COALESCE(NULLIF($6, '')::numeric, monthly_payout),
  updated_at      = now()
WHERE smd_id = $7
RETURNING *;

      `,
      [
        smd_code,
        address,
        installed_at,
        purchase_price,
        sell_price,
        monthly_payout,
        smd_id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "SMD not found" });
    }

    res.status(200).json({
      message: "SMD updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Update SMD error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};



export const softDeleteSmd = async (req: Request, res: Response) => {
  const { smd_id } = req.params;

  if (!smd_id) {
    return res.status(400).json({ message: "smd_id is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE public.smds
      SET
        status = 'removed',
        is_active = false,
        updated_at = now()
      WHERE smd_id = $1
      RETURNING smd_id;
      `,
      [smd_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "SMD not found" });
    }

    res.status(200).json({
      message: "SMD deleted successfully",
      smd_id: rows[0].smd_id,
    });
  } catch (error) {
    console.error("Delete SMD error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


export const hardDeleteSmd = async (req: Request, res: Response) => {
  const { smd_id } = req.params;

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM public.smds WHERE smd_id = $1`,
      [smd_id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "SMD not found" });
    }

    res.status(200).json({ message: "SMD permanently deleted" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};
