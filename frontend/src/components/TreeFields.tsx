// Histograms filled from TTrees: the browser's branch panel and the Inspector's ref fields.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { addObject, targetPad, type AddMode } from "../actions";
import { useStore } from "../store";
import type { Ref, RefLike, RootObject, TreeFields, TreePreview } from "../types";

const formatBins = (bins: number[] | null | undefined) => (bins ? bins.join(", ") : "");

/** "50, 0, 200" or a list of edges; null while the text is not valid yet. */
export function parseBins(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 3) {
    const [n, lo, hi] = parts;
    return Number.isInteger(n) && n >= 1 && lo < hi ? parts : null;
  }
  return parts.every((x, i) => i === 0 || x > parts[i - 1]) ? parts : null;
}

/** Text input that commits on Enter or blur: each commit refills the histogram from the tree. */
function CommitInput({ value, onCommit, placeholder, invalid }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  invalid?: (v: string) => boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = invalid?.(text) ?? false;
  const commit = () => !bad && text !== value && onCommit(text);
  return (
    <input type="text" value={text} placeholder={placeholder} spellCheck={false}
      className={bad ? "invalid" : undefined}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(value);
      }} />
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

const CUT_HINT = "Python with branch names; ROOT-style && || ! also work, e.g. nMuon >= 2 && abs(Muon_eta) < 2.4";
const EXPR_HINT = "Branch or expression, e.g. Muon_pt[:, 0] or sqrt(px**2 + py**2); sum/max/min/num work per event";
const BINS_HINT = "n, lo, hi  (regular)  or  a list of more than three edges";

/** Editable expression, cut, weight and binning of the tree refs of a layer (Inspector). */
export function TreeRefFields({ refs, onChange }: { refs: RefLike; onChange: (refs: RefLike) => void }) {
  const list = Array.isArray(refs) ? refs : [refs];
  const edit = (i: number, patch: Partial<Ref>) => {
    const next = list.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(Array.isArray(refs) ? next : next[0]);
  };
  const text = (v: string) => (v.trim() === "" ? null : v.trim());
  return (
    <>
      {list.map((r, i) => r.expr && (
        <div key={i} className="tree-ref">
          {list.length > 1 && <div className="muted small">{r.file}: {r.path}</div>}
          <Row label="Expression" hint={EXPR_HINT}>
            <CommitInput value={r.expr} invalid={(v) => !v.trim()} onCommit={(v) => edit(i, { expr: v.trim() })} />
          </Row>
          <Row label="Bins" hint={BINS_HINT}>
            <CommitInput value={formatBins(r.bins)} invalid={(v) => !parseBins(v)}
              onCommit={(v) => edit(i, { bins: parseBins(v) })} />
          </Row>
          {r.yexpr && (
            <>
              <Row label="Y expression" hint={EXPR_HINT}>
                <CommitInput value={r.yexpr} invalid={(v) => !v.trim()} onCommit={(v) => edit(i, { yexpr: v.trim() })} />
              </Row>
              <Row label="Y bins" hint={BINS_HINT}>
                <CommitInput value={formatBins(r.ybins)} invalid={(v) => !parseBins(v)}
                  onCommit={(v) => edit(i, { ybins: parseBins(v) })} />
              </Row>
            </>
          )}
          <Row label="Cut" hint={CUT_HINT}>
            <CommitInput value={r.cut ?? ""} placeholder="(all entries)" onCommit={(v) => edit(i, { cut: text(v) })} />
          </Row>
          <Row label="Weight" hint="Expression; empty for unweighted">
            <CommitInput value={r.weight ?? ""} placeholder="1" onCommit={(v) => edit(i, { weight: text(v) })} />
          </Row>
        </div>
      ))}
    </>
  );
}

/** Browser panel for a picked tree branch: set up the expression and draw it. */
export function TreePanel({ file, tree, branch }: { file: string; tree: RootObject; branch: string }) {
  const spec = useStore((s) => s.spec);
  const [expr, setExpr] = useState(branch);
  const [cut, setCut] = useState("");
  const [weight, setWeight] = useState("");
  const [bins, setBins] = useState("");
  const [yexpr, setYexpr] = useState("");
  const [ybins, setYbins] = useState("");
  const [preview, setPreview] = useState<TreePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pad, setPad] = useState<string | undefined>(undefined);
  // The expression the bins were last suggested for: a new cut keeps bins the user typed.
  const suggestedFor = useRef<string | null>(null);

  useEffect(() => {
    suggestedFor.current = null;
    setExpr(branch);
    setCut("");
    setYexpr("");
    setYbins("");
  }, [file, tree.path, branch]);

  // Range and suggested bins from the first entries; refreshed as the expression or cut settle.
  useEffect(() => {
    if (!expr.trim()) return;
    const timer = window.setTimeout(() => {
      api.treePreview(file, tree.path, expr.trim(), cut.trim() || null)
        .then((p) => {
          setPreview(p);
          setError(null);
          if (p.bins && suggestedFor.current !== expr.trim()) {
            setBins(formatBins(p.bins));
            suggestedFor.current = expr.trim();
          }
        })
        .catch((e) => {
          setPreview(null);
          setError(e instanceof ApiError ? e.messages.join("; ") : String(e));
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [file, tree.path, expr, cut]);

  const parsed = parseBins(bins);
  const parsedY = yexpr.trim() ? parseBins(ybins) : null;
  const ready = !!expr.trim() && !!parsed && (!yexpr.trim() || !!parsedY) && !error;
  const fields = (): TreeFields => ({
    expr: expr.trim(), bins: parsed, cut: cut.trim() || null, weight: weight.trim() || null,
    ...(yexpr.trim() ? { yexpr: yexpr.trim(), ybins: parsedY } : {}),
  });

  const padIds = spec?.pads.map((p) => p.id) ?? [];
  const current = spec ? targetPad(spec, pad && padIds.includes(pad) ? pad : undefined).id : undefined;
  const draw = (mode: AddMode) => {
    const s = useStore.getState();
    if (!s.spec) {
      s.flash("Create a canvas first (File → New canvas)");
      s.setDialog("new");
      return;
    }
    addObject(file, tree, mode, current, fields());
  };
  const btn = (label: string, mode: AddMode, title: string) => (
    <button disabled={!ready} title={title} onClick={() => draw(mode)}>{label}</button>
  );

  return (
    <div className="object-panel tree-panel">
      <div className="object-title">
        <b>{tree.path.split("/").pop()}</b>
        <span className="muted">TTree · fill a histogram</span>
      </div>
      <Row label="Expression" hint={EXPR_HINT}>
        <input value={expr} spellCheck={false} onChange={(e) => setExpr(e.target.value)} />
      </Row>
      <Row label="Cut" hint={CUT_HINT}>
        <input value={cut} spellCheck={false} placeholder="(all entries)" onChange={(e) => setCut(e.target.value)} />
      </Row>
      <Row label="Weight" hint="Expression; empty for unweighted">
        <input value={weight} spellCheck={false} placeholder="1" onChange={(e) => setWeight(e.target.value)} />
      </Row>
      <Row label="Bins" hint={BINS_HINT}>
        <input value={bins} spellCheck={false} className={bins && !parsed ? "invalid" : undefined}
          onChange={(e) => setBins(e.target.value)} />
      </Row>
      <Row label="Y (2D)" hint="Optional: an expression for the y axis draws a 2D map">
        <input value={yexpr} spellCheck={false} placeholder="(1D)" onChange={(e) => setYexpr(e.target.value)} />
      </Row>
      {yexpr.trim() && (
        <Row label="Y bins" hint={BINS_HINT}>
          <input value={ybins} spellCheck={false} placeholder="e.g. 20, 0, 200"
            className={ybins && !parsedY ? "invalid" : undefined} onChange={(e) => setYbins(e.target.value)} />
        </Row>
      )}
      {error && <div className="banner error small">{error}</div>}
      {preview?.values && <Bars values={preview.values} />}
      {preview && !error && (
        <div className="muted small">
          {preview.count.toLocaleString()} values from the first {preview.sampled.toLocaleString()} of{" "}
          {preview.entries.toLocaleString()} entries
          {preview.min !== undefined && ` · range [${fmt(preview.min)}, ${fmt(preview.max!)}]`}
        </div>
      )}
      {spec && padIds.length > 1 && (
        <label className="row">
          <span className="row-label">Into pad</span>
          <select value={current} onChange={(e) => setPad(e.target.value)}>
            {padIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      )}
      <div className="object-actions">
        {yexpr.trim() ? btn("Draw 2D map", "auto", "Draw y vs x as a 2D histogram") : (
          <>
            {btn("Line", "step", "Draw as a step line")}
            {btn("Filled", "fill", "Draw as a filled histogram")}
            {btn("Data points", "data", "Draw as black points with Poisson errors")}
            {btn("Add to stack", "stack", "Add to the pad's stacked histogram (created if needed)")}
          </>
        )}
      </div>
    </div>
  );
}

const fmt = (n: number) => (Math.abs(n) >= 1e5 || (n !== 0 && Math.abs(n) < 1e-2) ? n.toExponential(2) : Number(n.toPrecision(4)).toString());

function Bars({ values }: { values: number[] }) {
  const max = Math.max(...values, 0) || 1;
  const w = 240, h = 56, bw = w / values.length;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const d = `M0,${h - 2} ` + values.map((v, i) => `L${i * bw},${y(v)} L${(i + 1) * bw},${y(v)}`).join(" ") + ` L${w},${h - 2}`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} />
    </svg>
  );
}

export const isTreeRef = (refs: RefLike) => (Array.isArray(refs) ? refs : [refs]).some((r) => !!r.expr);
