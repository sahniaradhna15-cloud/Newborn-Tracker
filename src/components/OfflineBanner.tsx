"use client";

/**
 * Slim, calm "you're offline" strip (Phase 3 Task 2). Renders nothing when
 * online and only a quiet neutral line when offline — no red, no alarm icon
 * (CLAUDE.md §11.3 tone applies to operational status too). `navigator.onLine`
 * is read only inside an effect so server render and first hydration match.
 */
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const sync = () => setIsOffline(navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      className="w-full bg-stone-200 px-4 py-1.5 text-center text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
    >
      You&apos;re offline — entries will sync when you&apos;re back online.
    </div>
  );
}
