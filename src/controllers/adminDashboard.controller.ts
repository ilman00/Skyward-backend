import { Request, Response } from "express";
import { pool } from "../config/db"; // adjust import to match your db config

export const getDashboardStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const statsQuery = `
      SELECT
        -- Total customers (non-deleted)
        (
          SELECT COUNT(*)::int
          FROM customers
          WHERE status != 'deleted'
        ) AS total_customers,

        -- Customers added this month
        (
          SELECT COUNT(*)::int
          FROM customers
          WHERE status != 'deleted'
            AND created_at >= date_trunc('month', now())
        ) AS customers_this_month,

        -- Customers added last month
        (
          SELECT COUNT(*)::int
          FROM customers
          WHERE status != 'deleted'
            AND created_at >= date_trunc('month', now()) - INTERVAL '1 month'
            AND created_at <  date_trunc('month', now())
        ) AS customers_last_month,

        -- Active marketers
        (
          SELECT COUNT(*)::int
          FROM marketers
          WHERE status = 'active'
        ) AS active_marketers,

        -- Marketers added this month
        (
          SELECT COUNT(*)::int
          FROM marketers
          WHERE status = 'active'
            AND created_at >= date_trunc('month', now())
        ) AS marketers_this_month,

        -- Total SMDs (non-removed)
        (
          SELECT COUNT(*)::int
          FROM smds
          WHERE status != 'removed'
        ) AS total_smds,

        -- SMDs added this month
        (
          SELECT COUNT(*)::int
          FROM smds
          WHERE status != 'removed'
            AND created_at >= date_trunc('month', now())
        ) AS smds_this_month,

        -- SMDs added last month
        (
          SELECT COUNT(*)::int
          FROM smds
          WHERE status != 'removed'
            AND created_at >= date_trunc('month', now()) - INTERVAL '1 month'
            AND created_at <  date_trunc('month', now())
        ) AS smds_last_month,

        -- Monthly rent liability: sum of monthly_rent for all active closings
        (
          SELECT COALESCE(SUM(monthly_rent), 0)::numeric
          FROM smd_closings
          WHERE status = 'active'
        ) AS monthly_rent_liability,

        -- Pending rent payouts this month
        (
          SELECT COUNT(*)::int
          FROM smd_rent_payouts
          WHERE status = 'pending'
            AND payout_month = to_char(now(), 'YYYY-MM')
        ) AS pending_rent_payouts_this_month
    `;

    const result = await pool.query(statsQuery);
    const row = result.rows[0];

    // Calculate trends (percentage change vs last month)
    const customerTrend =
      row.customers_last_month > 0
        ? Math.round(
            ((row.customers_this_month - row.customers_last_month) /
              row.customers_last_month) *
              100
          )
        : null;

    const smdTrend =
      row.smds_last_month > 0
        ? Math.round(
            ((row.smds_this_month - row.smds_last_month) /
              row.smds_last_month) *
              100
          )
        : null;

    res.status(200).json({
      success: true,
      data: {
        total_customers: row.total_customers,
        customers_this_month: row.customers_this_month,
        customer_trend: customerTrend,

        active_marketers: row.active_marketers,
        marketers_this_month: row.marketers_this_month,

        total_smds: row.total_smds,
        smds_this_month: row.smds_this_month,
        smd_trend: smdTrend,

        monthly_rent_liability: Number(row.monthly_rent_liability),
        pending_rent_payouts_this_month: row.pending_rent_payouts_this_month,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};