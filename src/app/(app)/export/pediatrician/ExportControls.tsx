"use client";

/**
 * Date-range picker + "Download PDF" for the pediatrician export. Changing
 * either date re-navigates the server page (so the preview re-fetches the
 * SHARED range rollup); the download link points straight at
 * `/api/export/pediatrician` with the same range, so the PDF and the
 * on-screen preview always agree.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  fromYmd: string;
  toYmd: string;
  downloadHref: string;
};

export function ExportControls({ fromYmd, toYmd, downloadHref }: Props) {
  const router = useRouter();
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);

  function apply() {
    const params = new URLSearchParams({ from, to });
    router.push(`/export/pediatrician?${params.toString()}`);
  }

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <Label htmlFor="export_from">From</Label>
          <Input
            id="export_from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="export_to">To</Label>
          <Input
            id="export_to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={apply}>
          Update preview
        </Button>
        <a href={downloadHref} download className={buttonVariants({ variant: "default" })}>
          Download PDF
        </a>
      </div>
    </div>
  );
}
