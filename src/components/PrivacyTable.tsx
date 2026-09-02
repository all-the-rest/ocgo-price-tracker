import { createMemo, For, Show } from "solid-js";
import type { Translation } from "../i18n";
import Heading from "./Heading";
import type { FreeModel, Model, Privacy } from "../types";
import { fmtDateOnly, formatFreeModelName } from "../util";
import { privacyBadgeClass, privacyLabel, privacySortKey, privacyTier } from "../privacy";
import type { PrivacySortField, PrivacySortState } from "../sort";

interface PrivacyTableProps {
  models: Model[];
  freeModels: FreeModel[];
  t: Translation;
  lang: "de" | "en";
  sort: PrivacySortState;
  setSort: (u: (prev: PrivacySortState) => PrivacySortState) => void;
}

interface Row {
  name: string;
  privacy: Privacy | null;
}

export default function PrivacyTable(props: PrivacyTableProps) {
  const rows = createMemo(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const m of props.models) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push({ name: m.name, privacy: m.privacy });
    }
    for (const f of props.freeModels) {
      out.push({ name: formatFreeModelName(f), privacy: f.privacy });
    }
    return out;
  });

  const sorted = createMemo(() => {
    const { field, dir } = props.sort;
    return [...rows()].sort((a, b) => {
      if (field === "tier") {
        const ka = privacySortKey(a.privacy);
        const kb = privacySortKey(b.privacy);
        if (ka !== kb) return (ka - kb) * dir;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      }
      const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * dir;
      return privacySortKey(a.privacy) - privacySortKey(b.privacy);
    });
  });

  const thSort = (field: PrivacySortField, label: string) => {
    const active = props.sort.field === field;
    return (
      <th>
        <button
          class="inline-flex items-center gap-1 whitespace-nowrap"
          classList={{ "text-primary": active }}
          onClick={() =>
            props.setSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))
          }
        >
          {label}
          {active ? <span aria-hidden="true">{props.sort.dir === 1 ? "▲" : "▼"}</span> : null}
        </button>
      </th>
    );
  };

  const validUntilCell = (row: Row) => {
    const p = row.privacy;
    if (!p) return props.t.noValue;
    // Abgelaufenes ZDR (z. B. DeepSeek V4 Flash nach 31.08.) wird als Worst-Case
    // mit training:true + validUntil="2026-08-31" persistiert — "Gültig bis …"
    // wäre irreführend. Zeige stattdessen "ZDR-Abkommen nicht verlängert".
    if (p.training && p.validUntil) return props.t.validUntilExpired;
    if (p.validUntil) return fmtDateOnly(`${p.validUntil}T00:00:00.000Z`, props.lang);
    return privacyTier(p) === "training" ? props.t.noValue : props.t.validUntilDefault;
  };

  return (
    <section id="privacy" class="mt-10">
      <Heading anchor="privacy">{props.t.headingPrivacy}</Heading>
      <p class="mt-1 text-sm text-base-content/90">{props.t.privacyNote}</p>
      <div class="mt-4 max-w-full overflow-x-auto">
        <table class="table table-sm table-zebra">
          <thead>
            <tr>
              {thSort("model", props.t.colModel)}
              {thSort("tier", props.t.privacyLabel)}
              <th>{props.t.colValidUntil}</th>
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(row) => (
                <tr>
                  <td class="font-medium">{row.name}</td>
                  <td>
                    <Show
                      when={row.privacy}
                      fallback={<span class="badge badge-ghost badge-sm whitespace-nowrap">{props.t.privacyUnknown}</span>}
                    >
                      {(p) => (
                        <span class={`badge badge-sm whitespace-nowrap ${privacyBadgeClass(p())}`}>
                          {p().fallback ? "≈ " : ""}
                          {privacyLabel(p(), props.t)}
                        </span>
                      )}
                    </Show>
                  </td>
                  <td class="whitespace-nowrap tabular-nums">{validUntilCell(row)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}
