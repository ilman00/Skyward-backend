import { Request, Response } from "express";
import { pool } from "../config/db";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      email,
      role,
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.max(Number(limit), 1);
    const offset = (pageNumber - 1) * pageSize;

    let baseQuery = `
      FROM users u
      JOIN roles r ON r.role_id = u.role_id
      WHERE 1=1
    `;

    const values: any[] = [];
    let index = 1;

    if (email) {
      baseQuery += ` AND u.email ILIKE $${index++}`;
      values.push(`%${email}%`);
    }

    if (role) {
      baseQuery += ` AND r.role_name = $${index++}`;
      values.push(role);
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
        u.user_id,
        u.email,
        u.full_name,
        u.is_verified,
        u.created_at,
        u.last_login_at,
        r.role_name
      ${baseQuery}
      ORDER BY u.created_at DESC
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
      message: "Failed to fetch users",
    });
  }
};
