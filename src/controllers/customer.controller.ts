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

    if (!full_name || !email || !password) {
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
      [full_name, email, passwordHash, customerRoleId]
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
    const user = req.user as any; // typed AuthRequest is better

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = (page - 1) * limit;

    let conditions: string[] = [];
    let values: any[] = [];
    let idx = 1;

    conditions.push(`c.status != 'deleted'`);
    /* -----------------------------
       Role-based access
    ------------------------------*/
    if (user.role === "staff") {
      conditions.push(`c.created_by = $${idx++}`);
      values.push(user.user_id);
    }
    // admin → no restriction

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
       Total count
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
       Paginated data
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
    c.created_at,

    creator.full_name AS created_by_name,

    COALESCE(
  json_agg(
    json_build_object(
      'smd_id', s.smd_id,
      'smd_code', s.smd_code,
      'title', s.title,
      'city', s.city,
      'area', s.area,
      'address', s.address,
      'monthly_payout', sc.monthly_rent,
      'sell_price', sc.sell_price,
      'status', sc.status
    )
  ) FILTER (WHERE s.smd_id IS NOT NULL),
  '[]'
) AS smds


  FROM customers c
  JOIN users u ON u.user_id = c.user_id
  JOIN roles r ON r.role_id = u.role_id
  JOIN users creator ON creator.user_id = c.created_by

  LEFT JOIN smd_closings sc 
  ON sc.customer_id = c.customer_id
  AND sc.status = 'active'

LEFT JOIN smds s 
  ON s.smd_id = sc.smd_id


  ${whereClause}
  GROUP BY
    c.customer_id,
    u.user_id,
    r.role_name,
    creator.full_name
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
    res.status(500).json({ message: "Failed to fetch customers" });
  } finally {
    client.release();
  }
};


export const searchCustomersByName = async (req: Request, res: Response) => {
  const q = req.query.q as string || ""; // Default to empty string

  // We only search by name if 'q' exists, otherwise we just get the latest/top customers
  const queryText = `
    SELECT 
      c.customer_id,
      u.full_name
    FROM customers c
    JOIN users u ON u.user_id = c.user_id
    WHERE c.status = 'active'
      ${q ? "AND u.full_name ILIKE '%' || $1 || '%'" : ""}
    ORDER BY u.full_name
    LIMIT 10
  `;

  try {
    const values = q ? [q] : [];
    const { rows } = await pool.query(queryText, values);

    

    res.status(200).json(rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};



export const deleteCustomer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { customerId } = req.params;
    const user = req.user as any;

    if (!customerId) {
      return res.status(400).json({
        message: "Customer ID is required",
      });
    }

    let conditions: string[] = [
      `customer_id = $1`,
      `status != 'deleted'`,
    ];

    let values: any[] = [customerId];
    let idx = 2;

    /* -----------------------------
       Role-based restriction
    ------------------------------*/
    if (user.role === "staff") {
      conditions.push(`created_by = $${idx}`);
      values.push(user.user_id);
      idx++;
    }
    // admin → no restriction

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const deleteQuery = `
      UPDATE customers
      SET
        status = 'deleted',
        updated_at = NOW()
      ${whereClause}
      RETURNING customer_id
    `;

    const result = await client.query(deleteQuery, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        message:
          "Customer not found or you are not allowed to delete this customer",
      });
    }

    res.status(200).json({
      message: "Customer deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to delete customer",
    });
  } finally {
    client.release();
  }
};



export const newCreateCustomer = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      full_name,
      email,
      password,

      contact_number,
      city,
      address,
      cnic,

      bank_name,
      account_name,
      account_number,

      heir,
      marketer_id
    } = req.body;

    const creator_id = req.user!.user_id;

    // ✅ REQUIRED VALIDATION
    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "full_name, email and password are required"
      });
    }

    // ✅ Check email uniqueness
    const existingUser = await pool.query(
      `SELECT 1 FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (existingUser.rowCount && existingUser.rowCount > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already exists"
      });
    }

    // ✅ Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    await client.query("BEGIN");

    // ✅ Create user
    const userRes = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role_id)
       VALUES ($1, $2, $3,
         (SELECT role_id FROM roles WHERE role_name = 'customer' LIMIT 1))
       RETURNING user_id`,
      [full_name, email, passwordHash]
    );

    const userId = userRes.rows[0].user_id;

    // ✅ Insert customer profile
    const customerRes = await client.query(
      `INSERT INTO customers (
        user_id,
        contact_number,
        city,
        address,
        cnic,
        marketer_id,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING customer_id`,
      [
        userId,
        contact_number || null,
        city || null,
        address || null,
        cnic || null,
        marketer_id || null,
        creator_id
      ]
    );

    const customerId = customerRes.rows[0].customer_id;

    // ✅ Insert bank details if provided
    if (bank_name || account_name || account_number) {
      await client.query(
        `INSERT INTO customer_bank_accounts
         (customer_id, bank_name, account_name, account_number)
         VALUES ($1,$2,$3,$4)`,
        [
          customerId,
          bank_name || null,
          account_name || null,
          account_number || null
        ]
      );
    }

    // ✅ Insert heir if provided
    if (heir && heir.full_name) {
      await client.query(
        `INSERT INTO customer_heirs
        (customer_id, full_name, cnic, phone_number)
        VALUES ($1,$2,$3,$4)`,
        [
          customerId,
          heir.full_name,
          heir.cnic || null,
          heir.phone_number || null
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: {
        customer_id: customerId,
        user_id: userId
      }
    });

  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("Create customer error:", error);

    res.status(500).json({
      success: false,
      message: error.detail || "Failed to create customer"
    });

  } finally {
    client.release();
  }
};


export const getCustomerDetails = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {

    /* =========================
       1️⃣ CUSTOMER DETAILS
    ========================== */
    const customerQuery = `
      SELECT 
        c.customer_id,
        u.full_name,
        u.email,
        c.contact_number,
        c.cnic,
        c.city,
        c.address,
        c.created_at,
        mu.full_name AS reference_name
      FROM customers c
      JOIN users u ON c.user_id = u.user_id
      LEFT JOIN marketers m ON c.marketer_id = m.marketer_id
      LEFT JOIN users mu ON m.user_id = mu.user_id
      WHERE c.customer_id = $1
    `;

    const customerRes = await pool.query(customerQuery, [id]);

    if (customerRes.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const customer = customerRes.rows[0];


    /* =========================
       2️⃣ SMD CLOSINGS
    ========================== */
    const smdQuery = `
      SELECT
        sc.smd_closing_id,
        s.smd_id,
        s.smd_code,
        s.title,
        s.city,
        s.area,
        sc.closed_at AS closing_date,
        sc.sell_price,
        sc.monthly_rent,
        sc.total_amount_due,
        sc.amount_paid,
        sc.remaining_balance,
        sc.status AS closing_status
      FROM smd_closings sc
      JOIN smds s ON sc.smd_id = s.smd_id
      WHERE sc.customer_id = $1
      ORDER BY sc.closed_at DESC
    `;

    const smdRes = await pool.query(smdQuery, [id]);

    const closings = smdRes.rows;

    const closingIds = closings.map(c => c.smd_closing_id);

    /* =========================
       3️⃣ RENT PAYOUTS
    ========================== */
    let payoutsMap: Record<string, any[]> = {};

    if (closingIds.length > 0) {

      const payoutQuery = `
        SELECT *
        FROM smd_rent_payouts
        WHERE smd_closing_id = ANY($1::uuid[])
        ORDER BY payout_month DESC
      `;

      const payoutRes = await pool.query(payoutQuery, [closingIds]);

      // Group payouts by closing id
      payoutRes.rows.forEach(p => {
        if (!payoutsMap[p.smd_closing_id]) {
          payoutsMap[p.smd_closing_id] = [];
        }
        payoutsMap[p.smd_closing_id].push(p);
      });
    }


    /* =========================
       4️⃣ FINAL RESPONSE
    ========================== */
    const response = {
      customer_id: customer.customer_id,
      full_name: customer.full_name,
      reference: customer.reference_name || null,
      email: customer.email,
      contact_number: customer.contact_number,
      cnic: customer.cnic,
      city: customer.city,
      address: customer.address,
      created_at: customer.created_at,

      smds: closings.map(closing => ({
        smd_closing_id: closing.smd_closing_id,
        smd_id: closing.smd_id,
        smd_code: closing.smd_code,
        title: closing.title,
        city: closing.city,
        area: closing.area,
        closing_date: closing.closing_date,
        sell_price: closing.sell_price,
        monthly_rent: closing.monthly_rent,
        total_amount_due: closing.total_amount_due,
        amount_paid: closing.amount_paid,
        remaining_balance: closing.remaining_balance,
        status: closing.closing_status,

        rent_payouts: payoutsMap[closing.smd_closing_id] || []
      }))
    };

    console.log(response);
    

    res.status(200).json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error("❌ Get customer details error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch customer details"
    });
  }
};

