/**
 * CSRF / Origin guard for state-changing API requests.
 *
 * We authenticate the PWA with a cookie, so cross-site form posts are a
 * CSRF risk. Defenses (TECHNICAL_SPEC §4.3), all required together on
 * mutations:
 *   1. SameSite=Lax on the session cookie (set in session.ts)
 *   2. `X-Requested-With: fetch` — a cross-origin <form> cannot set it
 *   3. `Origin` must equal NEXT_PUBLIC_APP_URL
 *
 * Bearer-token routes (/api/events, /api/voice) authenticate by token,
 * not cookie, so CSRF does not apply — they are exempt.
 *
 * Session *resolution* is deliberately NOT done here (it needs the DB);
 * route handlers call withAuth() themselves.
 */
import { NextResponse, type NextRequest } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BEARER_EXEMPT = ["/api/events", "/api/voice"];

export function middleware(req: NextRequest): NextResponse {
  if (!MUTATING.has(req.method)) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (BEARER_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const allowedOrigin = appUrl ? new URL(appUrl).origin : req.nextUrl.origin;

  const origin = req.headers.get("origin");
  const requestedWith = req.headers.get("x-requested-with");

  if (origin !== allowedOrigin || requestedWith !== "fetch") {
    return NextResponse.json(
      {
        ok: false,
        error: "csrf_check_failed",
        say: "Sorry, that didn't work.",
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
