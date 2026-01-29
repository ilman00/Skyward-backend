import { Request, Response} from 'express';
import { pool } from '../config/db';


export const getCustomerSmds = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { search, page = "1", limit = "10" } = req.query;

    const pageNumber = Math.max(parseInt(page as string, 10), 1);
    const pageSize = Math.max(parseInt(limit as string, 10), 10);
    const offset = (pageNumber - 1) * pageSize;

    const values: any[] = [customerId];
    let searchCondition = "";

    if (search) {
      searchCondition = `
        AND (
          s.smd_code ILIKE $2
          OR s.title ILIKE $2
        )
      `;
      values.push(`%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*)
      FROM smds s
      INNER JOIN customers c ON c.user_id = s.owner_user_id
      WHERE c.customer_id = $1
      ${searchCondition}
    `;

    const dataQuery = `
      SELECT
        s.smd_id,
        s.smd_code,
        s.title,
        s.status,
        s.city,
        s.area,
        s.monthly_payout,
        s.is_active
      FROM smds s
      INNER JOIN customers c ON c.user_id = s.owner_user_id
      WHERE c.customer_id = $1
      ${searchCondition}
      ORDER BY s.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const totalResult = await pool.query(countQuery, values);
    const total = Number(totalResult.rows[0].count);

    const dataResult = await pool.query(dataQuery, [
      ...values,
      pageSize,
      offset,
    ]);

    res.json({
      meta: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      data: dataResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};



export const getLinkedSmdCustomers = async (req: Request, res: Response) => {
  try {
    const { search, page = "1", limit = "10" } = req.query;

    const pageNumber = Math.max(parseInt(page as string, 10), 1);
    const pageSize = Math.max(parseInt(limit as string, 10), 10);
    const offset = (pageNumber - 1) * pageSize;

    const values: any[] = [];
    let searchCondition = "";

    if (search) {
      // Search by SMD Code, Customer Name, or CNIC
      searchCondition = `
        WHERE s.smd_code ILIKE $1 
        OR u.full_name ILIKE $1 
        OR c.cnic ILIKE $1
      `;
      values.push(`%${search}%`);
    }

    // 1. Get Total Count for Pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM smds s
      LEFT JOIN users u ON s.owner_user_id = u.user_id
      LEFT JOIN customers c ON c.user_id = u.user_id
      ${searchCondition}
    `;

    // 2. Get Joined Data
    const dataQuery = `
      SELECT 
        s.smd_id,
        s.smd_code,
        s.title AS smd_title,
        s.status AS smd_status,
        s.city AS smd_city,
        u.user_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        c.contact_number,
        c.cnic
      FROM smds s
      LEFT JOIN users u ON s.owner_user_id = u.user_id
      LEFT JOIN customers c ON c.user_id = u.user_id
      ${searchCondition}
      ORDER BY s.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(dataQuery, [...values, pageSize, offset]);

    return res.status(200).json({
      meta: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error("Error fetching linked data:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};