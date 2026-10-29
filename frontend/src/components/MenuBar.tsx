import { useEffect, useRef, useState } from "react";
import { addLine, addText, deleteSelection, exportAs, targetPad, toggleLabel } from "../actions";
import { useStore } from "../store";

interface Item {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}
type Entry = Item | "-";

const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";

export function MenuBar() {
  const store = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hasDoc = store.spec !== null;

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const newCanvas = () => {
    if (store.dirty && !window.confirm("Discard unsaved changes?")) return;
    store.setDialog("new");
  };
  const sel = store.selection;
  const canDelete = !!sel && !["canvas", "pad", "xaxis", "yaxis"].includes(sel.type);

  const menus: Record<string, Entry[]> = {
    File: [
      { label: "New canvas…", action: newCanvas },
      { label: "Open…", action: () => store.flash("Double-click a .yaml plot file in the browser on the left to open it") },
      "-",
      { label: "Save", shortcut: `${mod}S`, action: () => store.setDialog("save"), disabled: !hasDoc },
      "-",
      { label: "Export PDF", action: () => exportAs("pdf"), disabled: !hasDoc },
      { label: "Export PNG", action: () => exportAs("png"), disabled: !hasDoc },
      { label: "Export SVG", action: () => exportAs("svg"), disabled: !hasDoc },
      { label: "Export Python script", action: () => exportAs("py"), disabled: !hasDoc },
      { label: "Export plot file (YAML)", action: () => exportAs("yaml"), disabled: !hasDoc },
    ],
    Edit: [
      { label: "Undo", shortcut: `${mod}Z`, action: store.undo, disabled: !store.past.length },
      { label: "Redo", shortcut: `${mod}⇧Z`, action: store.redo, disabled: !store.future.length },
      "-",
      { label: "Delete selected", shortcut: "Del", action: deleteSelection, disabled: !canDelete },
    ],
    Insert: [
      { label: "Text", shortcut: "T", action: () => addText(), disabled: !hasDoc },
      { label: "Horizontal line", action: () => addLine("hline"), disabled: !hasDoc },
      { label: "Vertical line", action: () => addLine("vline"), disabled: !hasDoc },
      "-",
      { label: "Ratio / pull…", action: () => store.setDialog("ratio"), disabled: !hasDoc },
      { label: "Experiment label on/off", disabled: !hasDoc,
        action: () => store.spec && toggleLabel(targetPad(store.spec).id) },
    ],
    Canvas: [
      { label: "Panels & margins…", action: () => store.setDialog("layout"), disabled: !hasDoc },
      { label: "Canvas settings", action: () => store.select({ type: "canvas" }), disabled: !hasDoc },
    ],
  };

  return (
    <div className="menubar" ref={ref}>
      <span className="brand">hep-pad</span>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menu">
          <button className={open === name ? "menu-title open" : "menu-title"}
            onMouseDown={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => open && setOpen(name)}>
            {name}
          </button>
          {open === name && (
            <div className="menu-items">
              {items.map((it, i) =>
                it === "-" ? <div key={i} className="menu-sep" /> : (
                  <button key={i} disabled={it.disabled}
                    onClick={() => { setOpen(null); it.action(); }}>
                    <span>{it.label}</span>
                    {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <span className="spacer" />
      <span className="doc-name" title={store.docPath ?? "not saved yet"}>
        {store.docPath ? store.docPath.split("/").pop() : "untitled"}{store.dirty ? " •" : ""}
      </span>
    </div>
  );
}
