import { useState } from "react";
import { createBreakdownBands } from "../actions";
import { envelopeSyst, normSyst, shapeSyst } from "../spec";
import { useStore } from "../store";
import type { Symmetrize, SystBreakdown, SystGroups, Systematic, SystSummary } from "../types";
import { NumberInput, Section, SelectField } from "./fields";

const list = (text: string) => text.split(/[,\s]+/).filter(Boolean);
const pct = (x: number) => `${(x * 100).toFixed(x < 0.001 ? 3 : x < 0.1 ? 2 : 1)}%`;

/** Edits one list of systematics. ``onChange`` receives the whole new list. */
export function SystematicsEditor(props: {
  title: string;
  items: Systematic[];
  onChange: (items: Systematic[], key?: string) => void;
  symmetrize?: Symmetrize;
  onSymmetrize?: (v: Symmetrize) => void;
  hint?: string;
}) {
  const { title, items, onChange, symmetrize, onSymmetrize, hint } = props;
  const inputs = useStore((s) => Object.keys(s.spec?.inputs ?? {}));
  const set = (i: number, patch: Partial<Systematic>, key?: string) =>
    onChange(items.map((x, j) => (j === i ? ({ ...x, ...patch } as Systematic) : x)), key && `syst.${i}.${key}`);
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const fileSelect = (i: number, file: string | null) => (
    <label className="row">
      <span className="row-label">File</span>
      <select value={file ?? ""} onChange={(e) => set(i, { file: e.target.value || null })}>
        <option value="">same as nominal</option>
        {inputs.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  );

  return (
    <Section title={title}>
      {hint && <p className="hint">{hint}</p>}
      {items.length === 0 && <p className="muted small">None.</p>}
      {items.map((x, i) => (
        <div key={i} className="syst-item">
          <div className="syst-head">
            <span className="tag">{x.kind === "norm" ? "norm" : x.kind === "shape" ? "shape" : "envelope"}</span>
            <b>{x.kind === "shape" ? (x.sources ? x.sources.join(", ") : "all matching sources") : x.source}</b>
            <button className="link" onClick={() => remove(i)}>remove</button>
          </div>
          {x.kind === "shape" && (
            <>
              <TextRow label="Up" value={x.up} onChange={(v) => set(i, { up: v }, "up")} />
              <TextRow label="Down" value={x.down ?? ""} placeholder="(none: mirror up)"
                onChange={(v) => set(i, { down: v || null }, "down")} />
              <TextRow label="Sources" value={x.sources?.join(", ") ?? ""} placeholder="(all found in the file)"
                onChange={(v) => set(i, { sources: list(v).length ? list(v) : null }, "sources")} />
              <TextRow label="Exclude" value={x.exclude.join(", ")} placeholder="regex, e.g. ^stat_"
                onChange={(v) => set(i, { exclude: list(v) }, "exclude")} />
              {fileSelect(i, x.file)}
            </>
          )}
          {x.kind === "norm" && (
            <>
              <TextRow label="Source" value={x.source} onChange={(v) => set(i, { source: v }, "source")} />
              <label className="row"><span className="row-label">Up [%]</span>
                <NumberInput value={+(x.up * 100).toPrecision(6)} nullable={false} step={0.1} min={0}
                  onChange={(v) => set(i, { up: v! / 100 }, "up")} /></label>
              <label className="row"><span className="row-label">Down [%]</span>
                <NumberInput value={x.down === null ? null : +(x.down * 100).toPrecision(6)} step={0.1} min={0}
                  placeholder="same as up" onChange={(v) => set(i, { down: v === null ? null : v / 100 }, "down")} /></label>
            </>
          )}
          {x.kind === "envelope" && (
            <>
              <TextRow label="Source" value={x.source} onChange={(v) => set(i, { source: v }, "source")} />
              <TextRow label="Path" value={x.path} onChange={(v) => set(i, { path: v }, "path")} />
              <TextRow label="Variations" value={x.variations.join(", ")} placeholder="muR0p5, muR2, ..."
                onChange={(v) => set(i, { variations: list(v) }, "variations")} />
              {fileSelect(i, x.file)}
            </>
          )}
        </div>
      ))}
      <div className="object-actions">
        <button onClick={() => onChange([...items, shapeSyst()])} title="Up/down histograms found from a name pattern">+ Shape</button>
        <button onClick={() => onChange([...items, normSyst(items.some((x) => x.kind === "norm") ? "norm" : "lumi")])}
          title="Flat relative uncertainty">+ Normalization</button>
        <button onClick={() => onChange([...items, envelopeSyst()])} title="Per-bin envelope of several variations">+ Envelope</button>
      </div>
      {onSymmetrize && symmetrize && (
        <SelectField label="Symmetrize" value={symmetrize}
          options={[{ value: "none", label: "no (asymmetric)" }, { value: "max", label: "larger of up/down" }, { value: "average", label: "average of up/down" }]}
          onChange={onSymmetrize} />
      )}
      <p className="hint">
        Patterns: <code>{"{path}"}</code> nominal path, <code>{"{dir}"}</code>/<code>{"{name}"}</code> its folder and
        name, <code>{"{source}"}</code> the source, <code>{"{variation}"}</code> an envelope variation.
      </p>
    </Section>
  );
}

function TextRow({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <input type="text" value={value} placeholder={placeholder} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Named groups of sources, each a list of regular expressions over source names. */
export function GroupsEditor({ groups, breakdown, onChange }: {
  layerId: string;
  groups: SystGroups;
  breakdown: SystBreakdown | undefined;
  onChange: (g: SystGroups, key?: string) => void;
}) {
  const entries = Object.entries(groups);
  const write = (next: [string, string[]][], key?: string) => onChange(Object.fromEntries(next), key);
  const matched = (name: string) => breakdown?.groups.find((g) => g.group === name)?.sources;
  const other = breakdown?.groups.find((g) => g.group === "Other");
  const newName = () => {
    for (let i = 1; ; i++) if (!(`Group ${i}` in groups)) return `Group ${i}`;
  };
  return (
    <Section title="Source groups">
      <p className="hint">Group sources to show them together in bands and in the breakdown. Patterns are regular expressions, e.g. <code>^JE</code>; ungrouped sources go to “Other”.</p>
      {entries.map(([name, patterns], i) => (
        <div key={i} className="syst-item">
          <div className="syst-head">
            <input type="text" value={name} spellCheck={false} title="Group name"
              onChange={(e) => write(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)), `group.${i}.name`)} />
            <button className="link" onClick={() => write(entries.filter((_, j) => j !== i))}>remove</button>
          </div>
          <label className="row"><span className="row-label">Patterns</span>
            <input type="text" value={patterns.join(", ")} spellCheck={false} placeholder="^JES, ^JER"
              onChange={(e) => write(entries.map((x, j) => (j === i ? [x[0], e.target.value.split(/[,\s]+/).filter(Boolean)] : x)), `group.${i}.patterns`)} />
          </label>
          {matched(name) && <span className="muted small">{matched(name)!.length ? matched(name)!.join(", ") : "matches nothing"}</span>}
        </div>
      ))}
      {other && entries.length > 0 && <p className="muted small"><b>Other:</b> {other.sources.join(", ")}</p>}
      <div className="object-actions">
        <button onClick={() => write([...entries, [newName(), []]])}>+ Group</button>
      </div>
    </Section>
  );
}

/** One click: a set of bands showing the breakdown, in the chosen pad. */
export function BreakdownBands({ layerId, padId }: { layerId: string; padId: string }) {
  const spec = useStore((s) => s.spec)!;
  // Default to a ratio-style pad sharing x with this one.
  const ratioPad = spec.pads.find((p) => p.sharex === padId)?.id ?? padId;
  const [target, setTarget] = useState(ratioPad);
  const [mode, setMode] = useState<"nested" | "separate">("nested");
  return (
    <Section title="Show breakdown as bands">
      <label className="row"><span className="row-label">In pad</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {spec.pads.map((p) => <option key={p.id} value={p.id}>{p.id}{p.id === padId ? " (absolute)" : " (relative)"}</option>)}
        </select></label>
      <label className="row"><span className="row-label">Style</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as "nested" | "separate")}>
          <option value="nested">nested: stat, + each group, total</option>
          <option value="separate">separate lines per group</option>
        </select></label>
      <button onClick={() => createBreakdownBands(layerId, target, mode)}>Create bands</button>
      <p className="hint">Uses the groups above (or stat / syst without groups). Running it again replaces the bands it made.</p>
    </Section>
  );
}

/** Per-source impact table, as computed by the last render. */
export function Breakdown({ data }: { data: SystBreakdown | undefined }) {
  const [showMissing, setShowMissing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  if (!data) return null;
  const scale = Math.max(data.combined.up, data.combined.down, 1e-12);
  const row = (name: string, x: SystSummary, cls = "", title?: string) => (
    <tr key={name} className={cls}>
      <td title={title ?? name}>
        <span className="bar" style={{ width: `${Math.min(100, (Math.max(x.up, x.down) / scale) * 100)}%` }} />
        {name}
      </td>
      <td>{pct(x.up)}</td><td>{pct(x.down)}</td><td>{pct(Math.max(x.up_max, x.down_max))}</td>
    </tr>
  );
  const grouped = data.groups.length > 0;
  return (
    <Section title="Uncertainty breakdown">
      <table className="breakdown">
        <thead>
          <tr><th>Relative to nominal</th><th title="Yield-weighted average">↑ avg</th><th>↓ avg</th><th title="Largest single bin">max bin</th></tr>
        </thead>
        <tbody>
          {row("Stat. (MC)", data.stat)}
          {grouped
            ? [...data.groups].sort((a, b) => Math.max(b.up, b.down) - Math.max(a.up, a.down))
                .map((g) => row(g.group, g, "group", g.sources.join(", ")))
            : data.sources.map((x) => row(x.source, x))}
          {row("Syst. total", data.total, "total")}
          {row("Stat. ⊕ syst.", data.combined, "total")}
          {grouped && showSources && data.sources.map((x) => row(x.source, x, "source"))}
        </tbody>
      </table>
      {grouped && (
        <button className="link" onClick={() => setShowSources(!showSources)}>
          {showSources ? "hide single sources" : `show all ${data.sources.length} sources`}
        </button>
      )}
      {data.missing.length > 0 && (
        <p className="warning-text">
          {data.missing.length} variation histogram{data.missing.length === 1 ? " was" : "s were"} not found{" "}
          <button className="link" onClick={() => setShowMissing(!showMissing)}>{showMissing ? "hide" : "show"}</button>
          {showMissing && (
            <span className="missing">
              {data.missing.map(([src, path], i) => <span key={i}><b>{src}</b> {path}</span>)}
            </span>
          )}
          <br /><span className="muted">A missing down variation mirrors the up shift; a missing up variation means that sample has no shift for the source.</span>
        </p>
      )}
    </Section>
  );
}
