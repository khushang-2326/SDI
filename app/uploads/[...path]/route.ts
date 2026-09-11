import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;
  const rawFileName = decodeURIComponent(segments.join("/"));

  // Prevent directory traversal
  const safeFileName = path.normalize(rawFileName).replace(/^(\.\.[\/\\])+/, "");
  const baseName = path.basename(safeFileName);

  const filePath = path.join(process.cwd(), "public", "uploads", baseName);

  try {
    const fileBuffer = await fs.readFile(filePath);

    // Clean friendly filename for user download (strip timestamp prefix: 1788873862742-30-form.xlsx -> 30-form.xlsx)
    const friendlyName = baseName.replace(/^\d+-/, "");

    let contentType = "application/octet-stream";
    if (baseName.endsWith(".xlsx")) {
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (baseName.endsWith(".xls")) {
      contentType = "application/vnd.ms-excel";
    } else if (baseName.endsWith(".csv")) {
      contentType = "text/csv; charset=utf-8";
    } else if (baseName.endsWith(".pdf")) {
      contentType = "application/pdf";
    } else if (/\.(png|jpe?g|webp)$/i.test(baseName)) {
      contentType = /\.jpe?g$/i.test(baseName) ? "image/jpeg" : "image/png";
    }

    const isInline = request.nextUrl.searchParams.get("inline") === "1";
    const dispositionType = isInline ? "inline" : "attachment";

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${dispositionType}; filename="${friendlyName}"; filename*=UTF-8''${encodeURIComponent(friendlyName)}`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  } catch {
    return new NextResponse("File not found", { status: 404 });
  }
}
