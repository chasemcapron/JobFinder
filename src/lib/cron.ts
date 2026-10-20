import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Cron routes accept only Vercel Cron's "Authorization: Bearer <CRON_SECRET>". Returns the error
 * response to send, or null when the request may run. Without CRON_SECRET every request is refused.
 */
export function rejectUnlessCron(req: NextRequest): NextResponse | null {
  const secret = env.cronSecret;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  if (given.length === expected.length && timingSafeEqual(given, expected)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
