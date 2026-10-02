import { createSignal, onCleanup, onMount } from "solid-js";
import type { Translation } from "../i18n";
import type { HolidayCalendar, PeakRule } from "../types";
import Tooltip from "./Tooltip";
import { fmtDateOnly } from "../util";
import {
  calendarLabel,
  formatDayList,
  formatDayScope,
  isBeforeEffectiveFrom,
  isPeakAt,
  nextTransition,
  timezoneLabel,
} from "../config/peakPricing";

export const isPeakTier = (tier: string | null): boolean => /^(?:off[- ]?peak|peak)$/i.test(tier ?? "");

export const isPeakNamedTier = (tier: string | null): boolean => /^peak$/i.test(tier ?? "");

/**
 * Ist die Stufe gerade „wirksam"? „Peak" ist aktiv, wenn gerade Peak ist,
 * „Off-Peak" umgekehrt. Ohne Regel (keine Daten) gilt Off-Peak — wie zuvor mit
 * leeren Fenstern.
 */
export function isTierActive(
  tier: string | null,
  now: number,
  rule: PeakRule | undefined,
  calendar?: HolidayCalendar,
): boolean {
  if (!isPeakTier(tier)) return true;
  const inPeak = rule ? isPeakAt(rule, calendar, now) : false;
  return isPeakNamedTier(tier) ? inPeak : !inPeak;
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
  rule: PeakRule;
  calendar?: HolidayCalendar;
  now: number;
  t: Translation;
  lang: "de" | "en";
}

export default function PeakIndicator(props: PeakIndicatorProps) {
  const active = () => isPeakAt(props.rule, props.calendar, props.now);
  const transition = () => nextTransition(props.rule, props.calendar, props.now);
  const countdown = () => {
    const timestamp = transition();
    return timestamp === null ? "–" : formatDuration(timestamp - props.now);
  };
  const phase = () => (active() ? props.t.peak : props.t.offPeak);
  const daily = () => (props.lang === "de" ? "täglich" : "daily");
  const scope = () => {
    const dayScope = formatDayScope(props.rule.peak.days, props.lang);
    return dayScope === daily() ? dayScope : `${dayScope} (${timezoneLabel(props.rule.timezone, props.lang)})`;
  };
  const weekend = () =>
    props.rule.offPeak.days.length === 0
      ? ""
      : props.t.peakWeekendNote
          .replace("{days}", formatDayList(props.rule.offPeak.days, props.lang))
          .replace("{tz}", timezoneLabel(props.rule.timezone, props.lang));
  const holiday = () =>
    props.rule.holidays
      ? props.t.peakHolidayNote.replace("{calendar}", calendarLabel(props.rule.holidays.calendar, props.lang))
      : "";
  const preEffective = () =>
    isBeforeEffectiveFrom(props.rule, props.now) && props.rule.effectiveFrom
      ? props.t.peakPreEffective.replace("{date}", fmtDateOnly(props.rule.effectiveFrom, props.lang))
      : "";
  const tooltip = () =>
    [
      props.t.peakTooltip
        .replace("{phase}", phase())
        .replace("{utc}", formatUtcRange(props.rule.peak.windowsUtc))
        .replace("{scope}", scope())
        .replace("{local}", formatLocalRange(props.rule.peak.windowsUtc, props.now))
        .replace("{countdown}", countdown()),
      weekend(),
      holiday(),
      preEffective(),
    ]
      .filter((part) => part !== "")
      .join(" · ");

  return (
    <Tooltip tip={tooltip()} class="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 leading-none">
      <span class="inline-flex items-center gap-1 whitespace-nowrap leading-none">
        <span class="icon-[material-symbols--schedule] h-4 w-4 shrink-0 self-center" aria-hidden="true" />
        <span class="leading-none">{props.tier}</span>
      </span>
      <span class="shrink-0 tabular-nums leading-none text-base-content/70">· {countdown()}</span>
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
