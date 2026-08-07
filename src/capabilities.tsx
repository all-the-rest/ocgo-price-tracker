import { For, Show } from "solid-js";
import type { Translation } from "./i18n";
import type { Capabilities } from "./types";

export type CapId = "image" | "video" | "audio" | "pdf";

export const CAP_IDS: readonly CapId[] = ["image", "video", "audio", "pdf"];

export function capsOf(m: { capabilities: Capabilities | null }): Set<CapId> {
  const c = m.capabilities;
  if (!c) return new Set<CapId>();
  return new Set(c.input.filter((mod): mod is CapId => mod !== "text"));
}

export function capLabel(id: CapId, t: Translation): string {
  return id === "pdf" ? t.capDocs : id === "image" ? t.capImage : id === "video" ? t.capVideo : t.capAudio;
}

export function fmtCaps(c: Capabilities | null, t: Translation): string {
  if (!c) return t.noValue;
  const parts: string[] = [];
  for (const id of CAP_IDS) {
    if (c.input.includes(id)) parts.push(capLabel(id, t));
  }
  return parts.length > 0 ? parts.join(", ") : t.noValue;
}

export function capCount(c: Capabilities | null): number {
  return c ? c.input.length + c.output.length + (c.reasoning ? 1 : 0) + (c.toolCall ? 1 : 0) : 0;
}

export function CapabilityBadges(props: { m: { capabilities: Capabilities | null }; t: Translation }) {
  const has = (id: CapId) => capsOf(props.m).has(id);
  return (
    <Show when={capsOf(props.m).size > 0} fallback={<span>{props.t.noValue}</span>}>
      <div class="flex flex-wrap gap-1">
        <For each={CAP_IDS}>
          {(id) => (
            <Show when={has(id)}>
              <span class="badge badge-sm badge-ghost">{capLabel(id, props.t)}</span>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

export function CapabilityFilter(props: {
  value: () => CapId[];
  setter: (u: (prev: CapId[]) => CapId[]) => void;
  t: Translation;
}) {
  return (
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <span>{props.t.capsLabel}</span>
      <For each={CAP_IDS}>
        {(id) => (
          <label class="label cursor-pointer gap-2">
            <span class="label-text">{capLabel(id, props.t)}</span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              checked={props.value().includes(id)}
              onChange={(e) =>
                props.setter((prev) =>
                  e.currentTarget.checked
                    ? prev.includes(id)
                      ? prev
                      : [...prev, id]
                    : prev.filter((x) => x !== id)
                )
              }
            />
          </label>
        )}
      </For>
    </div>
  );
}
