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

    let baseQuery = `FROM smds WHERE 1=1`;
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

