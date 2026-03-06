// src/utils/generatePdf.ts
import os from "os";
import fs from "fs";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

export async function generatePdfFromHtml(
    html: string,
    filename: string
): Promise<Buffer> {
    const platform = os.platform();

    if (platform === "win32") {
        return generateWithPuppeteer(html);
    } else {
        return generateWithWeasyPrint(html, filename);
    }
}

// ---- Windows (dev) ----
async function generateWithPuppeteer(html: string): Promise<Buffer> {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
    });

    await browser.close();
    return Buffer.from(pdfBuffer);
}

// ---- Ubuntu (prod) ----
async function generateWithWeasyPrint(
    html: string,
    filename: string
): Promise<Buffer> {
    const tmpHtml = `/tmp/${filename}.html`;
    const tmpPdf  = `/tmp/${filename}.pdf`;

    await fs.promises.writeFile(tmpHtml, html, "utf8");
    await execAsync(`weasyprint ${tmpHtml} ${tmpPdf}`);

    const pdfBuffer = await fs.promises.readFile(tmpPdf);

    await Promise.all([
        fs.promises.unlink(tmpHtml),
        fs.promises.unlink(tmpPdf),
    ]);

    return pdfBuffer;
}