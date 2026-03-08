import { Request, Response } from "express";
import { pool } from "../config/db"; // Adjust the import path as needed


// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface RecordPaymentBody {
  customer_id: string;
  smd_id: string;
  amount: number;
  payment_method?: string;
  reference_no?: string;
  notes?: string;
}

interface SmdClosingRow {
  smd_closing_id: string;
  remaining_balance: number;
  created_at: Date;
}

interface PaymentBreakdownItem {
  smd_closing_id: string;
  amount_applied: number;
  closing_fully_paid: boolean;
}

// ─────────────────────────────────────────────
// Helper: validate UUID format
// ─────────────────────────────────────────────

const isValidUUID = (val: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

// ─────────────────────────────────────────────
// Controller: Record Closing Payment (FIFO)
// ─────────────────────────────────────────────

export const recordClosingPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    customer_id,
    smd_id,
    amount,
    payment_method,
    reference_no,
    notes,
  }: RecordPaymentBody = req.body;

  // ── 1. Authenticated user from middleware ──
  const recorded_by: string = (req as any).user?.user_id;

  // ── 2. Input Validation ──
  if (!customer_id || !smd_id || !amount) {
    res.status(400).json({
      success: false,
      message: "customer_id, smd_id, and amount are required.",
    });
    return;
  }

  if (!isValidUUID(customer_id) || !isValidUUID(smd_id)) {
    res.status(400).json({
      success: false,
      message: "Invalid UUID format for customer_id or smd_id.",
    });
    return;
  }

  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({
      success: false,
      message: "Amount must be a positive number.",
    });
    return;
  }

  if (!recorded_by || !isValidUUID(recorded_by)) {
    res.status(401).json({
      success: false,
      message: "Unauthorized. Valid user session required.",
    });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ── 3. Lock and fetch active closings with remaining balance (FIFO) ──
    const closingsResult = await client.query<SmdClosingRow>(
      `SELECT smd_closing_id, remaining_balance, created_at
       FROM smd_closings
       WHERE customer_id = $1
         AND smd_id = $2
         AND status = 'active'
         AND remaining_balance > 0
       ORDER BY created_at ASC
       FOR UPDATE`, // row-level lock to prevent race conditions
      [customer_id, smd_id]
    );

    const closings = closingsResult.rows;

    if (closings.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        success: false,
        message:
          "No active closings with outstanding balance found for this customer and SMD.",
      });
      return;
    }

    // ── 4. Check total remaining balance across all closings ──
    const totalRemaining = closings.reduce(
      (sum, c) => sum + Number(c.remaining_balance),
      0
    );

    if (amount > totalRemaining) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: `Payment amount (${amount}) exceeds total remaining balance (${totalRemaining.toFixed(2)}).`,
        total_remaining_balance: totalRemaining,
      });
      return;
    }

    // ── 5. Distribute payment using FIFO ──
    let remainingPayment = amount;
    const breakdown: PaymentBreakdownItem[] = [];

    for (const closing of closings) {
      if (remainingPayment <= 0) break;

      const closingBalance = Number(closing.remaining_balance);
      const amountForThisClosing = Math.min(remainingPayment, closingBalance);
      const isFullyPaid = amountForThisClosing >= closingBalance;

      // 5a. Insert payment record
      await client.query(
        `INSERT INTO smd_closing_payments
           (smd_closing_id, amount, payment_method, reference_no, notes, recorded_by, payment_date)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          closing.smd_closing_id,
          amountForThisClosing,
          payment_method ?? null,
          reference_no ?? null,
          notes ?? null,
          recorded_by,
        ]
      );

      // 5b. Update amount_paid on the closing
      //     remaining_balance is auto-computed as (sell_price - amount_paid)
      await client.query(
        `UPDATE smd_closings
         SET amount_paid = amount_paid + $1,
             updated_at  = NOW()
         WHERE smd_closing_id = $2`,
        [amountForThisClosing, closing.smd_closing_id]
      );

      // 5c. If fully paid, mark closing as completed
      if (isFullyPaid) {
        await client.query(
          `UPDATE smd_closings
           SET status     = 'completed',
               updated_at = NOW()
           WHERE smd_closing_id = $1`,
          [closing.smd_closing_id]
        );
      }

      breakdown.push({
        smd_closing_id: closing.smd_closing_id,
        amount_applied: amountForThisClosing,
        closing_fully_paid: isFullyPaid,
      });

      remainingPayment = parseFloat((remainingPayment - amountForThisClosing).toFixed(2));
    }

    await client.query("COMMIT");

    // ── 6. Return success response ──
    res.status(200).json({
      success: true,
      message: "Payment recorded successfully.",
      data: {
        total_paid: amount,
        payment_breakdown: breakdown,
        remaining_balance_after_payment: parseFloat(
          (totalRemaining - amount).toFixed(2)
        ),
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("[recordClosingPayment] Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error. Payment was not recorded.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    client.release();
  }
};


// ─────────────────────────────────────────────
// Controller: Get Remaining Balance by Customer + SMD
// ─────────────────────────────────────────────

export const getClosingBalance = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { customer_id, smd_id } = req.query as {
    customer_id: string;
    smd_id: string;
  };

  // ── 1. Validate ──
  if (!customer_id || !smd_id) {
    res.status(400).json({
      success: false,
      message: "customer_id and smd_id are required query parameters.",
    });
    return;
  }

  if (!isValidUUID(customer_id) || !isValidUUID(smd_id)) {
    res.status(400).json({
      success: false,
      message: "Invalid UUID format for customer_id or smd_id.",
    });
    return;
  }

  try {
    // ── 2. Fetch all active closings with their balances ──
    const result = await pool.query(
      `SELECT
         sc.smd_closing_id,
         sc.share_percentage,
         sc.sell_price,
         sc.amount_paid,
         sc.remaining_balance,
         sc.monthly_rent,
         sc.status,
         sc.created_at
       FROM smd_closings sc
       WHERE sc.customer_id = $1
         AND sc.smd_id = $2
         AND sc.status = 'active'
         AND sc.remaining_balance > 0
       ORDER BY sc.created_at ASC`,
      [customer_id, smd_id]
    );

    const closings = result.rows;

    if (closings.length === 0) {
      res.status(404).json({
        success: false,
        message: "No active closings with outstanding balance found.",
      });
      return;
    }

    // ── 3. Aggregate totals ──
    const total_sell_price = closings.reduce(
      (sum, c) => sum + Number(c.sell_price), 0
    );
    const total_amount_paid = closings.reduce(
      (sum, c) => sum + Number(c.amount_paid), 0
    );
    const total_remaining_balance = closings.reduce(
      (sum, c) => sum + Number(c.remaining_balance), 0
    );
    const total_share_percentage = closings.reduce(
      (sum, c) => sum + Number(c.share_percentage), 0
    );

    // ── 4. Return ──
    res.status(200).json({
      success: true,
      data: {
        summary: {
          total_closings: closings.length,
          total_share_percentage: parseFloat(total_share_percentage.toFixed(2)),
          total_sell_price: parseFloat(total_sell_price.toFixed(2)),
          total_amount_paid: parseFloat(total_amount_paid.toFixed(2)),
          total_remaining_balance: parseFloat(total_remaining_balance.toFixed(2)),
        },
        closings,
      },
    });
  } catch (error: any) {
    console.error("[getClosingBalance] Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};