import { Request, Response } from "express";
import puppeteer from "puppeteer";
import ejs from "ejs";
import path from "path";
import { pool } from "../config/db";
import dayjs from "dayjs";
import os from "os";

export const generateDealPDF = async (req: Request, res: Response) => {
    const { deal_id } = req.params;

    const client = await pool.connect();

    try {
        // 🔹 1. Fetch Deal + Customer name (from users) + new columns
        const dealRes = await client.query(
            `
            SELECT
                d.deal_id,
                d.total_amount,
                d.agreement_years,
                d.created_at,

                c.customer_id,
                c.cnic,
                c.phone_number,
                c.city,
                c.address,
                c.father_name,

                u.full_name AS customer_name

            FROM smd_deals d
            JOIN customers c ON c.customer_id = d.customer_id
            JOIN users u ON u.user_id = c.user_id
            WHERE d.deal_id = $1
            `,
            [deal_id]
        );

        if (!dealRes.rowCount) {
            return res.status(404).json({ message: "Deal not found" });
        }

        // 🔹 2. Fetch SMD closings linked to this deal
        const smdsRes = await client.query(
            `
            SELECT
                sc.smd_closing_id,
                sc.sell_price,
                sc.monthly_rent,
                sc.share_percentage,

                s.smd_code,
                s.title,
                s.city,
                s.area

            FROM smd_closings sc
            JOIN smds s ON s.smd_id = sc.smd_id
            WHERE sc.deal_id = $1
            `,
            [deal_id]
        );

        const deal = dealRes.rows[0];
        const smds = smdsRes.rows;

        // 🔹 3. Derived values
        const primarySmd = smds[0] ?? {};
        const formattedDate = dayjs(deal.created_at).format("DD-MM-YYYY");
        const agreementYears: number = deal.agreement_years ?? 3;

        const totalRent = primarySmd.monthly_rent
            ? (Number(primarySmd.monthly_rent) * 12 * agreementYears).toLocaleString()
            : "0";

        // 🔹 4. Render EJS template
        const html = await ejs.renderFile(
            path.join(__dirname, "../views/contract.ejs"),
            {
                ownership: {
                    customerName: deal.customer_name,
                    fatherName: deal.father_name ?? "",
                    cnic: deal.cnic,
                    mobile: deal.phone_number,
                    amount: Number(deal.total_amount),
                    serialNumber: primarySmd.smd_code ?? "N/A",
                    date: formattedDate,
                    // companyName and companyAddress fall back to defaults in the template
                },

                lease: {
                    date: formattedDate,
                    name: deal.customer_name,
                    fatherName: deal.father_name ?? "",
                    cnic: deal.cnic,
                    mobileNumber: deal.phone_number,
                    screenPercentage: primarySmd.share_percentage
                        ? `${primarySmd.share_percentage}%`
                        : "N/A",
                    screenNumber: primarySmd.smd_code ?? "N/A",
                    agreementYears: String(agreementYears),
                    rentPerScreen: primarySmd.monthly_rent
                        ? Number(primarySmd.monthly_rent).toLocaleString()
                        : "0",
                    totalRent,
                },

                buyback: {
                    date: formattedDate,
                },
            }
        );

        // 🔹 5. Generate PDF via Puppeteer
        const isLinux = os.platform() === "linux";

        const browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                ...(isLinux ? [
                    "--disable-dev-shm-usage",
                    "--no-zygote",
                    "--single-process",
                ] : []),
            ],
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
        });

        await browser.close();

        // 🔹 6. Send PDF
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename=deal-${deal_id}.pdf`,
        });

        res.send(pdfBuffer);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to generate PDF" });
    } finally {
        client.release();
    }
};