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
 * No-session routes (/api/recovery/redeem, /api/invites/[token]/accept)
 * are reached from devices that have NO session cookie yet (a lost
 * phone redeeming a code; a partner opening an invite link). They
 * cannot satisfy `X-Requested-With: fetch` from a fresh navigation, so
 * that header requirement is lifted for them — but the same-origin
 * `Origin` check still applies (a cross-site form post cannot forge a
 * matching Origin, and these endpoints are otherwise gated by an
 * unguessable hashed token + rate limiting). Phase 2 Task 2.
 *
 * Session *resolution* is deliberately NOT done here (it needs the DB);
 * route handlers call withAuth() themselves.
 */
import { NextResponse, type NextRequest } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BEARER_EXEMPT = ["/api/events", "/api/voice"];

// CSRF: keep the same-origin Origin check, drop only the
// X-Requested-With requirement for routes hit pre-session.
function isRequestedWithExempt(path: string): boolean {
  if (path === "/api/recovery/redeem") return true;
  // /api/invites/<token>/accept — exempt the accept sub-path only, not
  // the owner-only POST /api/invites mint (which IS a normal fetch).
  return /^\/api\/invites\/[^/]+\/accept$/.test(path);
}

export function proxy(req: NextRequest): NextResponse {
  if (!MUTATING.has(req.method)) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (BEARER_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  // Accept the configured public origin, the request's own origin, AND the
  // forwarded host (the public host a tunnel/proxy serves under). A request
  // whose Origin equals the host it was served from is by definition
  // same-origin (not a cross-site CSRF), so each of these is safe to accept —
  // and together they keep localhost dev and a rotating Cloudflare tunnel URL
  // working without re-editing NEXT_PUBLIC_APP_URL each time.
  const allowedOrigins = new Set<string>([req.nextUrl.origin]);
  if (appUrl) {
    allowedOrigins.add(new URL(appUrl).origin);
  }
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? "https";
    allowedOrigins.add(`${proto}://${forwardedHost.split(",")[0].trim()}`);
  }

  const origin = req.headers.get("origin");
  const requestedWith = req.headers.get("x-requested-with");
  const requestedWithOk =
    isRequestedWithExempt(path) || requestedWith === "fetch";

  if (origin === null || !allowedOrigins.has(origin) || !requestedWithOk) {
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
