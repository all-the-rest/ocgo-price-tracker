import { createSignal, onCleanup, onMount } from "solid-js";
import type { Translation } from "../i18n";
import type { PeakHours } from "../types";
import Tooltip from "./Tooltip";

export const normalizePeakModel = (name: string) => name.toLowerCase().replace(/[\s-]+/g, "");

export const isPeakTier = (tier: string | null): boolean => /^(?:off[- ]?peak|peak)$/i.test(tier ?? "");

export const isPeakNamedTier = (tier: string | null): boolean => /^peak$/i.test(tier ?? "");

export function isPeakActive(now: number, ranges: [number, number][]): boolean {
  const date = new Date(now);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return ranges.some(([start, end]) => hour >= start && hour < end);
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
  const candidates = ranges.flatMap(([start, end]) => [
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), start),
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), end),
  ]);
  const next = candidates.find((timestamp) => timestamp > now);
  if (next !== undefined) return next;
  const [start] = ranges[0];
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, start);
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
      .replace("{countdown}", countdown());

  return (
    <Tooltip tip={tooltip()} class="inline-flex items-center gap-1">
      <span class="icon-[material-symbols--schedule] h-4 w-4" aria-hidden="true" />
      <span>{props.tier}</span>
      <span class="tabular-nums text-base-content/60">· {countdown()}</span>
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
