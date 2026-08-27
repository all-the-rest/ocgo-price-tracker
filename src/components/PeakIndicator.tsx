import { createSignal, onCleanup, onMount } from "solid-js";
import type { Translation } from "../i18n";
import type { PeakHours } from "../types";
import Tooltip from "./Tooltip";
import { PEAK_PRICING_RULES, isBeijingWeekend } from "../config/peakPricing";

export const normalizePeakModel = (name: string) => name.toLowerCase().replace(/[\s-]+/g, "");

export const isPeakTier = (tier: string | null): boolean => /^(?:off[- ]?peak|peak)$/i.test(tier ?? "");

export const isPeakNamedTier = (tier: string | null): boolean => /^peak$/i.test(tier ?? "");

/** Reine UTC-Stunden-Prüfung gegen die Peak-Fenster (alte Logik). */
function inUtcWindows(now: number, ranges: [number, number][]): boolean {
  const date = new Date(now);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return ranges.some(([start, end]) => hour >= start && hour < end);
}

export function isPeakActive(now: number, ranges: [number, number][]): boolean {
  if (ranges.length === 0) return false;
  // Am Wochenende (Sa/So, Peking-Zeit) gilt ab effectiveFrom durchgehend Off-Peak.
  if (now >= PEAK_PRICING_RULES.effectiveFromMs && isBeijingWeekend(now)) return false;
  return inUtcWindows(now, ranges);
}

export function isTierActive(
  tier: string | null,
  now: number,
  ranges: [number, number][]
): boolean {
  if (!isPeakTier(tier)) return true;
  const inPeak = isPeakActive(now, ranges);
  return isPeakNamedTier(tier) ? inPeak : !inPeak;
}

function nextTransition(now: number, ranges: [number, number][]): number | null {
  if (ranges.length === 0) return null;
  const date = new Date(now);
  const currentUtcMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  // Kandidaten für die nächsten ~8 Tage: Fenster-Grenzen (start/end jeder Range ab UTC-Mitternacht)
  // plus 16:00 UTC jedes Tages (= Peking-Mitternacht: Sa 00:00 Peking = Fr 16:00 UTC,
  // Mo 00:00 Peking = So 16:00 UTC — deckt beide Wochenendgrenzen ab).
  const candidates: number[] = [];
  for (let d = 0; d <= 8; d++) {
    const dayStart = currentUtcMidnight + d * DAY_MS;
    for (const [start, end] of ranges) {
      candidates.push(dayStart + start * HOUR_MS);
      candidates.push(dayStart + end * HOUR_MS);
    }
    candidates.push(dayStart + 16 * HOUR_MS);
  }
  if (now < PEAK_PRICING_RULES.effectiveFromMs) {
    candidates.push(PEAK_PRICING_RULES.effectiveFromMs);
  }
  const sorted = candidates.filter((timestamp) => timestamp > now).sort((a, b) => a - b);
  const currentState = isPeakActive(now, ranges);
  // Erster Kandidat, bei dem sich der Peak-Zustand tatsächlich ändert (Wochenend-Grenzen
  // erzeugen während des Pekinger Wochenends keine echten Zustandswechsel → werden rausgefiltert).
  for (const t of sorted) {
    if (isPeakActive(t, ranges) !== currentState) return t;
  }
  return null;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatUtcRange(ranges: [number, number][]): string {
  return ranges.map(([start, end]) => `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`).join(", ");
}

function formatLocalRange(ranges: [number, number][], now: number): string {
  const current = new Date(now);
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return ranges
    .map(([start, end]) => {
      const startDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), start));
      const endDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), end));
      return `${formatter.format(startDate)}–${formatter.format(endDate)}`;
    })
    .join(", ");
}

interface PeakIndicatorProps {
  tier: string;
  ranges: [number, number][];
  now: number;
  t: Translation;
}

export default function PeakIndicator(props: PeakIndicatorProps) {
  const active = () => isPeakActive(props.now, props.ranges);
  const transition = () => nextTransition(props.now, props.ranges);
  const countdown = () => {
    const timestamp = transition();
    return timestamp === null ? "–" : formatDuration(timestamp - props.now);
  };
  const phase = () => (active() ? props.t.peak : props.t.offPeak);
  const tooltip = () =>
    props.t.peakTooltip
      .replace("{phase}", phase())
      .replace("{utc}", formatUtcRange(props.ranges))
      .replace("{local}", formatLocalRange(props.ranges, props.now))
      .replace("{countdown}", countdown())
      .replace("{weekend}", props.t.peakWeekendNote);

  return (
    <Tooltip tip={tooltip()} class="inline-flex items-center gap-1 leading-none">
      <span class="icon-[material-symbols--schedule] h-4 w-4 shrink-0 self-center -translate-y-px" aria-hidden="true" />
      <span class="leading-none">{props.tier}</span>
      <span class="tabular-nums leading-none text-base-content/70">· {countdown()}</span>
    </Tooltip>
  );
}

export function usePeakClock() {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => window.clearInterval(timer));
  });
  return now;
}

export function peakRangesFor(peakHours: PeakHours | undefined, name: string): [number, number][] {
  return peakHours?.[normalizePeakModel(name)] ?? [];
}
