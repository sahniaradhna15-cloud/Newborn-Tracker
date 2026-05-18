/**
 * PediatricianPDF — the free single-page Letter export (Decision #4,
 * PLAN.md killer feature #4). `@react-pdf/renderer`, rendered server-side
 * in `/api/export/pediatrician` via `renderToStream`.
 *
 * Deliberate constraints (Task 4 DoD + CLAUDE.md §11.3):
 *  - ONE page, no scrolling — pediatricians scan, not read.
 *  - NO caregiver attribution: the doctor cares about the baby's intake,
 *    not who logged it.
 *  - NO `mom_events`: this component's props are STRUCTURALLY incapable
 *    of carrying mom data (the route's query never touches that table) —
 *    we do not merely rely on the `mom_events_self` RLS policy.
 *  - Calm, informational tone — no "alert/warning", no red. Footer is
 *    exactly "Informational, not medical advice."
 *
 * The shape of `days` is the SHARED `DaySummaryPayload` from
 * `day-summary.ts` (same reducer as the dashboard) so the PDF can never
 * disagree with the app's own numbers.
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { DaySummaryPayload } from "@/lib/day-summary";

/** One {@link DaySummaryPayload} plus its timezone-correct date label. */
export type PediatricianDay = DaySummaryPayload & { dateLabel: string };

export type PediatricianPDFData = {
  babyName: string;
  birthDateLabel: string;
  ageLabel: string;
  rangeLabel: string;
  days: PediatricianDay[];
  /** Feed/diaper notes only. NEVER mom_events (structurally excluded). */
  notes: { dateLabel: string; kind: string; text: string }[];
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: "#1c1917", fontFamily: "Helvetica" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 9, color: "#57534e", marginBottom: 1 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  table: { borderWidth: 1, borderColor: "#e7e5e4", borderRadius: 3 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e7e5e4" },
  rowLast: { flexDirection: "row" },
  th: {
    backgroundColor: "#f5f5f4",
    fontFamily: "Helvetica-Bold",
    padding: 5,
    fontSize: 8,
  },
  td: { padding: 5, fontSize: 8 },
  cDate: { width: "16%" },
  cNum: { width: "14%" },
  cBand: { width: "14%" },
  cStatus: { width: "14%" },
  cDiaperDate: { width: "34%" },
  cDiaperCol: { width: "33%" },
  note: { marginBottom: 3, fontSize: 8 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 36,
    right: 36,
    textAlign: "center",
    fontSize: 8,
    color: "#78716c",
  },
});

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function intakeStatus(total: number, low: number, high: number): string {
  if (total < low) return "below band";
  if (total > high) return "above band";
  return "within band";
}

export function PediatricianPDF({ data }: { data: PediatricianPDFData }) {
  return (
    <Document title={`${data.babyName} — feeding & diaper summary`}>
      <Page size="LETTER" style={styles.page}>
        <View>
          <Text style={styles.h1}>{data.babyName} — Feeding & Diaper Summary</Text>
          <Text style={styles.sub}>Date of birth: {data.birthDateLabel}</Text>
          <Text style={styles.sub}>Age: {data.ageLabel}</Text>
          <Text style={styles.sub}>Period: {data.rangeLabel}</Text>
        </View>

        <Text style={styles.sectionTitle}>Feeding (per day)</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cNum]}>Total oz</Text>
            <Text style={[styles.th, styles.cNum]}>Nursing oz</Text>
            <Text style={[styles.th, styles.cNum]}>Pumped oz</Text>
            <Text style={[styles.th, styles.cNum]}>Formula oz</Text>
            <Text style={[styles.th, styles.cBand]}>Target band</Text>
            <Text style={[styles.th, styles.cStatus]}>Status</Text>
          </View>
          {data.days.map((d, i) => {
            const isLast = i === data.days.length - 1;
            return (
              <View key={d.day_start} style={isLast ? styles.rowLast : styles.row}>
                <Text style={[styles.td, styles.cDate]}>{d.dateLabel}</Text>
                <Text style={[styles.td, styles.cNum]}>{fmt(d.feeds.total_oz)}</Text>
                <Text style={[styles.td, styles.cNum]}>{fmt(d.feeds.nursing_oz)}</Text>
                <Text style={[styles.td, styles.cNum]}>{fmt(d.feeds.pumped_oz)}</Text>
                <Text style={[styles.td, styles.cNum]}>{fmt(d.feeds.formula_oz)}</Text>
                <Text style={[styles.td, styles.cBand]}>
                  {fmt(d.target.low_oz)}–{fmt(d.target.high_oz)}
                </Text>
                <Text style={[styles.td, styles.cStatus]}>
                  {intakeStatus(d.feeds.total_oz, d.target.low_oz, d.target.high_oz)}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Diapers (per day)</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={[styles.th, styles.cDiaperDate]}>Date</Text>
            <Text style={[styles.th, styles.cDiaperCol]}>Wet</Text>
            <Text style={[styles.th, styles.cDiaperCol]}>Dirty</Text>
          </View>
          {data.days.map((d, i) => {
            const isLast = i === data.days.length - 1;
            return (
              <View key={d.day_start} style={isLast ? styles.rowLast : styles.row}>
                <Text style={[styles.td, styles.cDiaperDate]}>{d.dateLabel}</Text>
                <Text style={[styles.td, styles.cDiaperCol]}>{d.diapers.pee_count}</Text>
                <Text style={[styles.td, styles.cDiaperCol]}>{d.diapers.poop_count}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Notes</Text>
        {data.notes.length === 0 ? (
          <Text style={styles.note}>No notes recorded in this period.</Text>
        ) : (
          data.notes.map((n, idx) => (
            <Text key={`${n.dateLabel}-${idx}`} style={styles.note}>
              {n.dateLabel} · {n.kind}: {n.text}
            </Text>
          ))
        )}

        <Text style={styles.footer} fixed>
          Informational, not medical advice.
        </Text>
      </Page>
    </Document>
  );
}
