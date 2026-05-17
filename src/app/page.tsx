export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-16 text-center dark:bg-stone-950">
      <div className="max-w-md space-y-4">
        <p className="text-xs font-medium uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Newborn Tracker
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Setup complete.
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          The dashboard, logging forms, and intake intelligence land in later tasks of Phase 1.
          For now this confirms the toolchain is wired up.
        </p>
        <p className="pt-4 text-xs text-stone-500 dark:text-stone-500">
          Not medical advice. Call your pediatrician if you&apos;re worried.
        </p>
      </div>
    </main>
  );
}
