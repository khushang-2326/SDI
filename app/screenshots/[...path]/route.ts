import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;
  const fileName = segments.join("/");
  
  // Prevent directory traversal
  const safeFileName = path.normalize(fileName).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(process.cwd(), "public", "screenshots", safeFileName);

  try {
    const fileBuffer = await fs.readFile(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return new NextResponse("Screenshot not found", { status: 404 });
  }
}
