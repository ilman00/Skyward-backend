import { Request, Response } from "express";
import { pool } from "../config/db";
import bcrypt from "bcryptjs";


export const getUsers = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      role,
      search,
    } = req.query;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.max(Number(limit), 1);
    const offset = (pageNumber - 1) * pageSize;

    let baseQuery = `
      FROM users u
      JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_group = 'system'
    `;

    const values: any[] = [];
    let index = 1;

    // 🔎 Search
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

    // 🎭 Optional role filter (admin/staff only)
    if (role) {
      baseQuery += ` AND r.role_name = $${index++}`;
      values.push(role);
    }

    // 🔢 Count
    const countResult = await pool.query(
      `SELECT COUNT(*) ${baseQuery}`,
      values
    );
    const total = Number(countResult.rows[0].count);

    // 📄 Data
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
  const client = await pool.connect();

  try {
    const { userId } = req.params;
    const { full_name, role_name, status, password } = req.body;

    if (!userId) return res.status(400).json({ message: "User ID is required" });

    await client.query("BEGIN");

    // 1. Handle Role Update if role_name is provided
    if (role_name) {
      const roleResult = await client.query(
        "SELECT role_id FROM roles WHERE role_name = $1 AND role_group = 'system'",
        [role_name.toLowerCase()]
      );

      if (roleResult.rowCount === 0) {
        return res.status(400).json({ message: "Invalid system role name It should be Admin or staff" });
      }

      const newRoleId = roleResult.rows[0].role_id;

      // Wipe old system roles and insert new one
      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND role_id IN 
         (SELECT role_id FROM roles WHERE role_group = 'system')`,
        [userId]
      );
      await client.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, newRoleId]
      );
      // Sync the snapshot column on users table
      await client.query("UPDATE users SET role_id = $1 WHERE user_id = $2", [newRoleId, userId]);
    }

    // 2. Update dynamic profile fields
    const fields: string[] = [];
    const values: any[] = [];
    let index = 1;

    const updates: any = { full_name, status };
    
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        fields.push(`${key} = $${index++}`);
        values.push(val);
      }
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${index++}`);
      values.push(hashedPassword);
    }

    if (fields.length > 0) {
      values.push(userId);
      await client.query(
        `UPDATE users SET ${fields.join(", ")}, updated_at = now() WHERE user_id = $${index}`,
        values
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ message: "User updated successfully" });
  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
};

export const updateUserRoles = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { userId } = req.params;
    const { add_roles = [], remove_roles = [] } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID required" });
    }

    await client.query("BEGIN");

    // 🔴 Remove roles
    if (remove_roles.length > 0) {
      await client.query(
        `DELETE FROM user_roles
         WHERE user_id = $1 AND role_id = ANY($2::uuid[])`,
        [userId, remove_roles]
      );

      // 🧠 Domain rule → if marketer removed → deactivate marketer
      const marketerRole = await client.query(
        `SELECT role_id FROM roles WHERE role_name = 'marketer'`
      );

      if (marketerRole.rowCount) {
        const marketerRoleId = marketerRole.rows[0].role_id;

        if (remove_roles.includes(marketerRoleId)) {
          await client.query(
            `UPDATE marketers SET status = 'inactive' WHERE user_id = $1`,
            [userId]
          );
        }
      }
    }

    // 🟢 Add roles
    if (add_roles.length > 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [userId, add_roles]
      );
    }

    // 🔵 Recalculate highest priority role
    const highestRole = await client.query(
      `
      SELECT ur.role_id
      FROM user_roles ur
      JOIN roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.priority DESC
      LIMIT 1
      `,
      [userId]
    );

    if (highestRole.rowCount === 0) {
      throw new Error("User must have at least one role");
    }

    const primaryRoleId = highestRole.rows[0].role_id;

    // 🟣 Update users.role_id
    await client.query(
      `UPDATE users SET role_id = $1 WHERE user_id = $2`,
      [primaryRoleId, userId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "User roles updated successfully",
      primary_role: primaryRoleId,
    });

  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({
      message: "Failed to update roles",
      error: error.message,
    });
  } finally {
    client.release();
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


export const updateBusinessRoles = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { userId } = req.params;
    const { add_roles = [], remove_roles = [] } = req.body;

    await client.query("BEGIN");

    // 🔍 Validate roles belong to business group
    const rolesCheck = await client.query(
      `SELECT role_id, role_name FROM roles
       WHERE role_id = ANY($1::uuid[]) AND role_group = 'business'`,
      [[...add_roles, ...remove_roles]]
    );

    const validRoleIds = rolesCheck.rows.map(r => r.role_id);

    const invalidRoles = [...add_roles, ...remove_roles].filter(
      r => !validRoleIds.includes(r)
    );

    if (invalidRoles.length) {
      throw new Error("Invalid business roles detected");
    }

    // 🔴 Remove roles
    if (remove_roles.length) {
      await client.query(
        `DELETE FROM user_roles
         WHERE user_id = $1 AND role_id = ANY($2::uuid[])`,
        [userId, remove_roles]
      );

      const removedRoles = rolesCheck.rows.filter(r =>
        remove_roles.includes(r.role_id)
      );

      for (const role of removedRoles) {
        if (role.role_name === "marketer") {
          await client.query(
            `UPDATE marketers SET status = 'inactive' WHERE user_id = $1`,
            [userId]
          );
        }

        if (role.role_name === "customer") {
          await client.query(
            `UPDATE customers SET status = 'inactive' WHERE user_id = $1`,
            [userId]
          );
        }
      }
    }

    // 🟢 Add roles
    if (add_roles.length) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [userId, add_roles]
      );

      const addedRoles = rolesCheck.rows.filter(r =>
        add_roles.includes(r.role_id)
      );

      for (const role of addedRoles) {
        if (role.role_name === "marketer") {
          const exists = await client.query(
            `SELECT 1 FROM marketers WHERE user_id = $1`,
            [userId]
          );

          if (!exists.rowCount) {
            await client.query(
              `INSERT INTO marketers (user_id, commission_value, created_by)
               VALUES ($1, 0, $2)`,
              [userId, req.user?.user_id]
            );
          }
        }

        if (role.role_name === "customer") {
          const exists = await client.query(
            `SELECT 1 FROM customers WHERE user_id = $1`,
            [userId]
          );

          if (!exists.rowCount) {
            await client.query(
              `INSERT INTO customers (user_id, created_by)
               VALUES ($1, $2)`,
              [userId, req.user?.user_id]
            );
          }
        }
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Business roles updated successfully",
    });

  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({
      message: error.message,
    });
  } finally {
    client.release();
  }
};

export const getMarketParticipants = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "10", search } = req.query;

    const user_id = req.user?.user_id;
    const role = req.user?.role;
    const isAdmin = role === "admin";

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.max(Number(limit), 1);
    const offset = (pageNumber - 1) * pageSize;

    const values: any[] = [];
    let index = 1;

    let baseQuery = `
      FROM users u
      LEFT JOIN marketers m ON m.user_id = u.user_id
      LEFT JOIN customers c ON c.user_id = u.user_id
      WHERE u.status != 'deleted'
      AND (m.marketer_id IS NOT NULL OR c.customer_id IS NOT NULL)
    `;

    // 🔐 Staff filter — customers and marketers they created
    if (!isAdmin) {
      baseQuery += ` AND (c.created_by = $${index} OR m.created_by = $${index})`;
      values.push(user_id);
      index++;
    }

    // 🔍 Search
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

    // 📊 Total count
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT u.user_id) ${baseQuery}`,
      values
    );

    const total = Number(countResult.rows[0].count);

    // 📦 Data query
    const dataQuery = `
      SELECT 
          u.user_id,
          u.full_name,
          u.email,
          u.avatar_url,

          m.marketer_id,
          m.commission_type,
          m.commission_value,
          m.status AS marketer_status,

          c.customer_id,
          c.phone_number,
          c.city,
          c.status AS customer_status

      ${baseQuery}

      ORDER BY u.created_at DESC
      LIMIT $${index++} OFFSET $${index++}
    `;

    values.push(pageSize, offset);

    const { rows } = await pool.query(dataQuery, values);

    // 🧠 Format response
    const formatted = rows.map(user => ({
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      avatar_url: user.avatar_url,

      roles: {
        is_marketer: !!user.marketer_id,
        is_customer: !!user.customer_id
      },

      marketer: user.marketer_id
        ? {
            marketer_id: user.marketer_id,
            commission_type: user.commission_type,
            commission_value: user.commission_value,
            status: user.marketer_status
          }
        : null,

      customer: user.customer_id
        ? {
            customer_id: user.customer_id,
            phone_number: user.phone_number,
            city: user.city,
            status: user.customer_status
          }
        : null
    }));

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: formatted
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch market participants"
    });
  }
};