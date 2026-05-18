"use client";

/**
 * Cross-platform "add to Home Screen" hint (Phase 3 Task 1).
 *
 * - Chromium (Android + desktop Chrome/Edge): captures the
 *   `beforeinstallprompt` event and shows a small calm button that triggers
 *   the native install flow.
 * - iOS Safari (no `beforeinstallprompt`): a one-time, dismissable bottom
 *   sheet with the manual "Share → Add to Home Screen" steps. A localStorage
 *   flag suppresses it on later visits.
 * - Already installed (display-mode: standalone, or iOS `navigator.standalone`):
 *   renders nothing.
 *
 * Calm styling only (CLAUDE.md §11.3): no red, no alarmist iconography.
 */

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const IOS_DISMISSED_KEY = "nt_ios_install_dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navStandalone = (window.navigator as Navigator & { standalone?: boolean })
    .standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navStandalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  // Exclude in-app/Chrome-on-iOS where "Add to Home Screen" is unavailable.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSheet, setShowIosSheet] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }
    function maybeShowIosSheet() {
      if (
        isIosSafari() &&
        window.localStorage.getItem(IOS_DISMISSED_KEY) !== "1"
      ) {
        setShowIosSheet(true);
      }
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    maybeShowIosSheet();

    return () =>
      window.removeEventListener(
        "beforeinstallprompt",
        onBeforeInstallPrompt,
      );
  }, []);

  async function onInstallClick() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  function dismissIosSheet() {
    window.localStorage.setItem(IOS_DISMISSED_KEY, "1");
    setShowIosSheet(false);
  }

  if (installEvent) {
    return (
      <button
        type="button"
        onClick={onInstallClick}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm text-foreground shadow-md transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
      >
        Install Newborn Tracker
      </button>
    );
  }

  if (showIosSheet) {
    return (
      <div
        role="dialog"
        aria-label="Install Newborn Tracker"
        className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-lg dark:border-stone-800 dark:bg-stone-950">
          <p className="text-base text-foreground">
            Add Newborn Tracker to your Home Screen
          </p>
          <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">
            Tap the Share icon in Safari&apos;s toolbar, then choose{" "}
            <span className="text-foreground">Add to Home Screen</span>. It
            opens full-screen, just like an app.
          </p>
          <button
            type="button"
            onClick={dismissIosSheet}
            className="mt-4 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return null;
}
