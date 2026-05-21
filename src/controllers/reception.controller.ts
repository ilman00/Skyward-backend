import { Request, Response } from "express";
import { pool } from "../config/db";

// POST /api/reception/visitors
export const checkInVisitor = async (req: Request, res: Response) => {
  const { full_name, host_name, checked_in_at, checked_out_at } = req.body;

  if (!full_name) {
    return res.status(400).json({ message: "full_name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reception_visitors
        (full_name, host_name, checked_in_at, checked_out_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        full_name,
        host_name ?? null,
        checked_in_at ?? new Date(),
        checked_out_at ?? null,
        req.user!.user_id,
      ]
    );

    return res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error("checkInVisitor error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /api/reception/visitors/:id
export const deleteVisitor = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM reception_visitors WHERE visitor_id = $1 RETURNING visitor_id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    return res.status(200).json({ message: "Visitor deleted successfully" });
  } catch (error) {
    console.error("deleteVisitor error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /api/reception/visitors
export const getVisitors = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
  const search = (req.query.search as string)?.trim() || "";
  const offset = (page - 1) * limit;

  try {
    const searchParam = search ? `%${search}%` : null;

    const whereClause = searchParam
      ? `WHERE full_name ILIKE $1 OR host_name ILIKE $1`
      : "";

    const countValues = searchParam ? [searchParam] : [];
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM reception_visitors ${whereClause}`,
      countValues
    );
    const total = parseInt(countResult.rows[0].count);
    const total_pages = Math.ceil(total / limit) || 1;

    const dataValues = searchParam
      ? [searchParam, limit, offset]
      : [limit, offset];

    const limitIdx = searchParam ? 2 : 1;
    const offsetIdx = searchParam ? 3 : 2;

    const dataResult = await pool.query(
      `SELECT * FROM reception_visitors
       ${whereClause}
       ORDER BY checked_in_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataValues
    );

    return res.status(200).json({
      data: dataResult.rows,
      total,
      total_pages,
      page,
      limit,
    });
  } catch (error) {
    console.error("getVisitors error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH /api/reception/visitors/:id
export const updateVisitor = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { full_name, host_name, checked_in_at, checked_out_at } = req.body;

  // Build dynamic SET clause — only update fields that were sent
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (full_name !== undefined) {
    fields.push(`full_name = $${idx++}`);
    values.push(full_name);
  }
  if (host_name !== undefined) {
    fields.push(`host_name = $${idx++}`);
    values.push(host_name);
  }
  if (checked_in_at !== undefined) {
    fields.push(`checked_in_at = $${idx++}`);
    values.push(checked_in_at);
  }
  if (checked_out_at !== undefined) {
    fields.push(`checked_out_at = $${idx++}`);
    values.push(checked_out_at);
  }

  if (fields.length === 0) {
    return res.status(400).json({ message: "No fields provided to update" });
  }

  values.push(id); // for WHERE clause

  try {
    const result = await pool.query(
      `UPDATE reception_visitors
       SET ${fields.join(", ")}
       WHERE visitor_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error("updateVisitor error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};