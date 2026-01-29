import { Request, Response } from "express";
import { pool } from "../config/db";
import bcrypt from "bcryptjs";


export const getUsers = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      role,
      search, // ✅ unified search
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

    if (search) {
      baseQuery += `
        AND (
          u.email ILIKE $${index}
          OR u.full_name ILIKE $${index}
        )
      `;
      values.push(`%${search}%`);
      index++;
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
        u.status,
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




export const updateUserByAdmin = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const {
      full_name,
      password,
      avatar_url,
      role_id,
      is_verified,
      status,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (full_name !== undefined) {
      fields.push(`full_name = $${index++}`);
      values.push(full_name);
    }

    if (avatar_url !== undefined) {
      fields.push(`avatar_url = $${index++}`);
      values.push(avatar_url);
    }

    if (role_id !== undefined) {
      fields.push(`role_id = $${index++}`);
      values.push(role_id);
    }

    if (is_verified !== undefined) {
      fields.push(`is_verified = $${index++}`);
      values.push(is_verified);
    }

    if (status !== undefined) {
      fields.push(`status = $${index++}`);
      values.push(status);
    }

    if (password !== undefined) {
      const hashedPassword = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${index++}`);
      values.push(hashedPassword);
    }

    if (!fields.length) {
      return res.status(400).json({
        message: "No valid fields provided for update",
      });
    }

    const query = `
      UPDATE users
      SET ${fields.join(", ")},
          updated_at = now()
      WHERE user_id = $${index}
      RETURNING user_id, email, full_name, role_id, is_verified, status
    `;

    values.push(userId);

    const { rowCount, rows } = await pool.query(query, values);

    if (!rowCount) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to update user",
    });
  }
};



export const softDeleteUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // check if user exists & not already deleted
    const userCheck = await pool.query(
      `
      SELECT user_id, status
      FROM users
      WHERE user_id = $1
      `,
      [userId]
    );

    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (userCheck.rows[0].status === "deleted") {
      return res.status(400).json({
        message: "User is already deleted",
      });
    }

    // soft delete
    await pool.query(
      `
      UPDATE users
      SET status = 'deleted',
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId]
    );

    res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to delete user",
    });
  }
};
