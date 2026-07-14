import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const safeName = path.basename(filename);
  if (safeName !== filename || !/\.(png|jpe?g)$/i.test(safeName)) {
    return new Response("Invalid screenshot name", { status: 400 });
  }

  const screenshotPath = path.join(process.cwd(), "public", "screenshots", safeName);
  try {
    const image = await fs.readFile(screenshotPath);
    return new Response(image, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": /\.jpe?g$/i.test(safeName) ? "image/jpeg" : "image/png"
      }
    });
  } catch {
    return new Response("Screenshot not found", { status: 404 });
  }
}
