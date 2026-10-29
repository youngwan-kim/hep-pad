import { moveLayer, setVisible } from "../actions";
import { sameSelection, type Selection } from "../spec";
import { useStore } from "../store";
import type { Layer } from "../types";

const KIND: Record<Layer["kind"], string> = {
  histogram: "hist", stack: "stack", errorband: "band", graph: "graph", hist2d: "2D", ratio: "ratio", pull: "pull",
};

const layerName = (l: Layer) =>
  "label" in l && l.label ? `${l.id} · ${l.label}` : l.id;

export function Outline() {
  const spec = useStore((s) => s.spec);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  if (!spec) return null;

  const item = (sel: Selection, content: React.ReactNode, depth: number, extra?: React.ReactNode, dim = false) => (
    <div
      className={`outline-item ${sameSelection(sel, selection) ? "active" : ""} ${dim ? "dim" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => select(sel)}
    >
      <span className="outline-name">{content}</span>
      {extra && <span className="outline-actions" onClick={(e) => e.stopPropagation()}>{extra}</span>}
    </div>
  );

  return (
    <div className="outline">
      {item({ type: "canvas" }, <b>Canvas</b>, 0)}
      {spec.pads.map((p) => (
        <div key={p.id}>
          {item({ type: "pad", pad: p.id }, <><span className="tag">pad</span>{p.id}</>, 1)}
          {p.label && item({ type: "label", pad: p.id }, <><span className="tag">label</span>{p.label.experiment} {p.label.text}</>, 2)}
          {p.layers.map((l, i) => (
            <div key={l.id}>
              {item(
                { type: "layer", pad: p.id, layer: l.id },
                <><span className="tag">{KIND[l.kind]}</span>{layerName(l)}</>,
                2,
                <>
                  <button title={l.visible ? "Hide" : "Show"} onClick={() => setVisible(p.id, l.id, !l.visible)}>
                    {l.visible ? "●" : "○"}
                  </button>
                  <button title="Draw earlier (further back)" disabled={i === 0} onClick={() => moveLayer(p.id, l.id, -1)}>▲</button>
                  <button title="Draw later (on top)" disabled={i === p.layers.length - 1} onClick={() => moveLayer(p.id, l.id, 1)}>▼</button>
                </>,
                !l.visible,
              )}
              {l.kind === "stack" && l.members.map((m, j) =>
                <div key={j}>
                  {item({ type: "member", pad: p.id, layer: l.id, index: j },
                    <><span className="swatch" style={{ background: m.color ?? "#ccc" }} />{m.label ?? `member ${j + 1}`}</>, 3)}
                </div>,
              )}
            </div>
          ))}
          {p.annotations.map((a, i) => (
            <div key={`a${i}`}>
              {item({ type: "annotation", pad: p.id, index: i },
                <><span className="tag">{a.kind}</span>{a.kind === "text" ? a.text : `${a.kind === "hline" ? "y" : "x"} = ${a.at}`}</>, 2)}
            </div>
          ))}
          {item({ type: "xaxis", pad: p.id }, <><span className="tag">axis</span>x{p.xaxis.label ? ` · ${p.xaxis.label}` : ""}</>, 2)}
          {item({ type: "yaxis", pad: p.id }, <><span className="tag">axis</span>y{p.yaxis.label ? ` · ${p.yaxis.label}` : ""}</>, 2)}
          {item({ type: "legend", pad: p.id }, <><span className="tag">legend</span>{p.legend.show ? p.legend.loc : "hidden"}</>, 2)}
        </div>
      ))}
    </div>
  );
}
