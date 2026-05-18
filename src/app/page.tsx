import { redirect } from "next/navigation";

import { getSessionAuthContext } from "@/lib/with-auth";

export default async function Home() {
  const auth = await getSessionAuthContext();
  if (!auth) redirect("/onboarding");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-16 text-center dark:bg-stone-950">
      <div className="max-w-md space-y-4">
        <p className="text-xs font-medium uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Newborn Tracker
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          You&apos;re signed in.
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          The TodayCard, logging forms, and intake intelligence land in Tasks
          1.3 and 1.4. This confirms onboarding and the session cookie work.
        </p>
        <p className="pt-4 text-xs text-stone-500 dark:text-stone-500">
          Not medical advice. Call your pediatrician if you&apos;re worried.
        </p>
      </div>
    </main>
  );
}
