"use client";

/**
 * RealtimeProvider — the only browser-side Supabase usage in the app
 * (Decision #3). It subscribes to feed/diaper inserts/updates/deletes for
 * the active baby and calls `router.refresh()`, which re-runs the SERVER
 * components (TodayCard, history) so both phones reflect each other within
 * ~2s. There is NO client-side cache of rows — the refresh re-fetches via
 * `getDaySummary`/`getRangeSummary` server-side (CLAUDE.md §3 rules 3–4).
 *
 * Auth model: the browser never sees a Supabase key with table access. It
 * GETs a 5-minute household-scoped JWT from `/api/realtime-token` (signed
 * server-side with the Supabase JWT secret, never the service-role key —
 * CLAUDE.md §8) and re-fetches it every 4 minutes so the socket never
 * drops on token expiry.
 *
 * First paint is never blocked: this renders `{children}` immediately and
 * does ALL socket work in an effect (client-only, post-hydration).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const TOKEN_REFRESH_MS = 4 * 60 * 1000;

type Props = {
  householdId: string;
  babyId: string;
  children: React.ReactNode;
};

async function fetchRealtimeToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/realtime-token", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; token?: string };
    return data.ok && typeof data.token === "string" ? data.token : null;
  } catch {
    // Offline / network error: the dashboard just stops auto-refreshing.
    // It is never broken by a missing socket (Task 4 DoD).
    return null;
  }
}

export function RealtimeProvider({ householdId, babyId, children }: Props) {
  const router = useRouter();
  const clientRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey || !householdId || !babyId) {
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientRef.current = client;

    const onChange = () => {
      router.refresh();
    };

    async function start() {
      const token = await fetchRealtimeToken();
      if (cancelled || token === null) return;

      client.realtime.setAuth(token);

      const channel = client
        .channel(`household:${householdId}`, { config: { private: true } })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "feed_events", filter: `baby_id=eq.${babyId}` },
          onChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "diaper_events", filter: `baby_id=eq.${babyId}` },
          onChange,
        )
        .subscribe();
      channelRef.current = channel;

      // Re-mint the short-lived token before it expires so the socket
      // never drops mid-session.
      refreshTimer = setInterval(async () => {
        const next = await fetchRealtimeToken();
        if (cancelled || next === null) return;
        client.realtime.setAuth(next);
      }, TOKEN_REFRESH_MS);
    }

    void start();

    return () => {
      cancelled = true;
      if (refreshTimer !== null) clearInterval(refreshTimer);
      if (channelRef.current !== null) {
        void client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      clientRef.current = null;
    };
  }, [householdId, babyId, router]);

  return <>{children}</>;
}
