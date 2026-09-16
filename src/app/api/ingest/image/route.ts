import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { rateLimit } from "@/lib/ratelimit";
import type { ClientContext } from "@/lib/types";

export const runtime = "nodejs";
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// POST multipart/form-data: file=<image>, context=<json>
export async function POST(req: Request) {
  const limited = rateLimit(req, "ingest");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const context = JSON.parse(String(form.get("context") ?? "{}")) as ClientContext;
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported image type ${file.type}. Use JPG, PNG or WebP.` }, { status: 415 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 5 MB after resizing)" }, { status: 413 });
    }
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const provider = await getProvider(keys);
    return NextResponse.json(await provider.captureImage(base64, file.type, context));
  } catch (e) {
    return aiError(e, "ingest/image", activeSource(keys));
  }
}
