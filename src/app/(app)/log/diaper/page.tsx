import { redirect } from "next/navigation";

/**
 * The app is a single page now — diaper logging lives inline in the
 * LogConsole on the dashboard. This route is kept only so old links /
 * bookmarks / Siri deep-links don't 404; it bounces to the one page.
 */
export default function LogDiaperPage() {
  redirect("/");
}
