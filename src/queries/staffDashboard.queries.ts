import {pool} from "../config/db"; // adjust to your db pool import

export const fetchStaffDashboardSummary = async (userId: string) => {
  const query = `
    SELECT
      -- Customers created by this staff member
      (
        SELECT COUNT(*)::int
        FROM customers
        WHERE created_by = $1
          AND status != 'deleted'
      ) AS total_customers,

      -- SMD closings (deals closed) by this staff member
      (
        SELECT COUNT(*)::int
        FROM smd_closings
        WHERE closed_by = $1
      ) AS total_contracts_closed,

      -- Total SMDs bought (unique SMDs across closings by this staff)
      (
        SELECT COUNT(DISTINCT smd_id)::int
        FROM smd_closings
        WHERE closed_by = $1
      ) AS total_smds_bought,

      -- Total rent paid for closings created by this staff member
      (
        SELECT COALESCE(SUM(srp.amount), 0)
        FROM smd_rent_payouts srp
        INNER JOIN smd_closings sc ON sc.smd_closing_id = srp.smd_closing_id
        WHERE sc.closed_by = $1
          AND srp.status = 'paid'
      ) AS total_rent_paid,

      -- Contracts expiring within 30 days
      -- Expiry = closed_at + agreement_years (from smd_deals), fallback 3 years
      (
        SELECT COUNT(*)::int
        FROM smd_closings sc
        LEFT JOIN smd_deals sd ON sd.deal_id = sc.deal_id
        WHERE sc.closed_by = $1
          AND sc.status = 'active'
          AND (
            sc.closed_at + (COALESCE(sd.agreement_years, 3) || ' years')::interval
          ) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
      ) AS expiring_contracts
  `;

  const { rows } = await pool.query(query, [userId]);
  return rows[0];
};