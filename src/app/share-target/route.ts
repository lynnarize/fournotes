import { NextResponse } from "next/server";

// The service worker normally intercepts shares to /share-target. This fallback
// covers the moment before it is installed: open the app instead of a 404.
export async function POST(req: Request) {
  return NextResponse.redirect(new URL("/", req.url), 303);
}
