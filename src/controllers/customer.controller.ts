import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config/db";

export const createCustomer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      full_name,
      email,
      password,
      contact_number,
      cnic,
      address,
      city,
    } = req.body;

    const adminId = req.user!.user_id;

    if ( !full_name || !email || !password) {
      return res.status(400).json({
        message: "Full name, mail and password are required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Check existing user
    const existingUser = await client.query(
      `SELECT 1 FROM users WHERE email = $1`,
      [email]
    );

    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "User with this email already exists",
      });
    }

    // 2️⃣ Get CUSTOMER role id (lowercase role name)
    const roleResult = await client.query(
      `SELECT role_id FROM roles WHERE role_name = 'customer'`
    );

    if (!roleResult.rowCount) {
      throw new Error("Customer role not found");
    }

    const customerRoleId = roleResult.rows[0].role_id;

    // 3️⃣ Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 4️⃣ Create user
    const userResult = await client.query(
      `
      INSERT INTO users (
        full_name,
        email,
        password_hash,
        role_id,
        is_verified
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING user_id
      `,
      [ full_name ,email, passwordHash, customerRoleId]
    );

    const userId = userResult.rows[0].user_id;

    // 5️⃣ Create customer profile
    await client.query(
      `
      INSERT INTO customers (
        user_id,
        contact_number,
        cnic,
        address,
        city,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        userId,
        contact_number || null,
        cnic || null,
        address || null,
        city || null,
        adminId,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Customer created successfully",
      data: {
        user_id: userId,
        email,
        role: "customer",
        is_verified: true,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      message: "Failed to create customer",
    });
  } finally {
    client.release();
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { userId } = req.params;

    const {
      role,       // role_name (optional)
      cnic,       // optional
      address,    // optional
      status,     // optional (active | suspended | deleted)
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userId param is required",
      });
    }

    await client.query("BEGIN");

    /* -----------------------------
       1️⃣ Check user exists
    ------------------------------*/
    const userCheck = await client.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId]
    );

    if (!userCheck.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "User not found",
      });
    }

    /* -----------------------------
       2️⃣ Update role (if provided)
    ------------------------------*/
    if (role) {
      const roleResult = await client.query(
        `SELECT role_id FROM roles WHERE role_name = $1`,
        [role]
      );

      if (!roleResult.rowCount) {
        throw new Error("Invalid role");
      }

      await client.query(
        `
        UPDATE users
        SET role_id = $1,
            updated_at = now()
        WHERE user_id = $2
        `,
        [roleResult.rows[0].role_id, userId]
      );
    }

    /* -----------------------------
       3️⃣ Update user status (if provided)
    ------------------------------*/
    if (status) {
      await client.query(
        `
        UPDATE users
        SET status = $1,
            updated_at = now()
        WHERE user_id = $2
        `,
        [status, userId]
      );
    }

    /* -----------------------------
       4️⃣ Update customer table fields
    ------------------------------*/
    const customerUpdates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (cnic !== undefined) {
      customerUpdates.push(`cnic = $${idx++}`);
      values.push(cnic);
    }

    if (address !== undefined) {
      customerUpdates.push(`address = $${idx++}`);
      values.push(address);
    }

    if (status !== undefined) {
      customerUpdates.push(`status = $${idx++}`);
      values.push(status);
    }

    if (customerUpdates.length) {
      customerUpdates.push(`updated_at = now()`);

      await client.query(
        `
        UPDATE customers
        SET ${customerUpdates.join(", ")}
        WHERE user_id = $${idx}
        `,
        [...values, userId]
      );
    }

    await client.query("COMMIT");

    res.status(200).json({
      message: "Customer updated successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(500).json({
      message: "Failed to update customer",
    });
  } finally {
    client.release();
  }
};


export const getAllCustomers = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { status, search } = req.query;

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(
      parseInt(req.query.limit as string) || 10,
      100
    );

    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`c.status = $${idx++}`);
      values.push(status);
    }

    if (search) {
      conditions.push(`
        (
          u.email ILIKE $${idx}
          OR u.full_name ILIKE $${idx}
          OR c.contact_number ILIKE $${idx}
          OR c.cnic ILIKE $${idx}
        )
      `);
      values.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    /* -----------------------------
       1️⃣ Total count query
    ------------------------------*/
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM customers c
      JOIN users u ON u.user_id = c.user_id
      ${whereClause}
    `;

    const countResult = await client.query(countQuery, values);
    const total = countResult.rows[0].total;

    /* -----------------------------
       2️⃣ Paginated data query
    ------------------------------*/
    const dataQuery = `
      SELECT
        c.customer_id,
        c.user_id,
        u.email,
        u.full_name,
        r.role_name AS role,
        c.contact_number,
        c.cnic,
        c.city,
        c.address,
        u.status AS user_status,
        c.status AS customer_status,
        u.is_verified,
        c.created_at
      FROM customers c
      JOIN users u ON u.user_id = c.user_id
      JOIN roles r ON r.role_id = u.role_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const dataResult = await client.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    res.status(200).json({
      message: "Customers fetched successfully",
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
      message: "Failed to fetch customers",
    });
  } finally {
    client.release();
  }
};
