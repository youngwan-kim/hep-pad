import { useEffect, useState, type ReactNode } from "react";
import { PALETTE } from "../spec";

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <span>{title}</span>
        {actions}
      </header>
      <div className="fields">{children}</div>
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  nullable?: boolean;
  hint?: string;
  autoFocus?: boolean;
}) {
  const { label, value, onChange, placeholder, nullable = true, hint, autoFocus } = props;
  return (
    <Row label={label} hint={hint}>
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value === "" && nullable ? null : e.target.value)}
      />
    </Row>
  );
}

/** Number input that keeps the typed text while it is not (yet) a valid number. */
export function NumberInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  nullable?: boolean;
  step?: number;
  min?: number;
  integer?: boolean;
}) {
  const { value, onChange, placeholder, nullable = true, step, min, integer } = props;
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (Number(text) !== value || (value === null && text !== "")) setText(value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      value={text}
      step={step ?? "any"}
      min={min}
      placeholder={placeholder ?? (nullable ? "auto" : "")}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") {
          if (nullable) onChange(null);
          return;
        }
        const n = Number(e.target.value);
        if (Number.isFinite(n) && (!integer || Number.isInteger(n)) && (min === undefined || n >= min)) onChange(n);
      }}
    />
  );
}

export function NumberField(props: Parameters<typeof NumberInput>[0] & { label: string; hint?: string }) {
  const { label, hint, ...rest } = props;
  return (
    <Row label={label} hint={hint}>
      <NumberInput {...rest} />
    </Row>
  );
}

export function RangeField(props: {
  label: string;
  value: [number, number] | null;
  onChange: (v: [number, number] | null) => void;
  current?: [number, number];
  hint?: string;
}) {
  const { label, value, onChange, current, hint } = props;
  const auto = value === null;
  const shown = value ?? current ?? [0, 1];
  const fmt = (n: number) => Number(n.toPrecision(4));
  return (
    <Row label={label} hint={hint}>
      <span className="range">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => onChange(e.target.checked ? null : [fmt(shown[0]), fmt(shown[1])])}
          />
          auto
        </label>
        {auto ? (
          current && <span className="muted">{fmt(current[0])} – {fmt(current[1])}</span>
        ) : (
          <>
            <NumberInput value={shown[0]} nullable={false} onChange={(v) => onChange([v!, shown[1]])} />
            <NumberInput value={shown[1]} nullable={false} onChange={(v) => onChange([shown[0], v!])} />
          </>
        )}
      </span>
    </Row>
  );
}

export function CheckField({ label, value, onChange, hint }: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

type Option<T> = T | { value: T; label: string };

export function SelectField<T extends string | number | boolean | null>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const { label, value, options, onChange, hint } = props;
  const opts = options.map((o) => (typeof o === "object" && o !== null ? o : { value: o, label: String(o ?? "default") }));
  const idx = opts.findIndex((o) => o.value === value);
  return (
    <Row label={label} hint={hint}>
      <select value={idx} onChange={(e) => onChange(opts[Number(e.target.value)].value)}>
        {idx < 0 && <option value={-1}>{String(value)}</option>}
        {opts.map((o, i) => (
          <option key={i} value={i}>{o.label}</option>
        ))}
      </select>
    </Row>
  );
}

const toHex = (c: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#000000");

export function ColorField({ label, value, onChange, nullable = true }: {
  label: string; value: string | null; onChange: (v: string | null) => void; nullable?: boolean;
}) {
  return (
    <Row label={label}>
      <span className="color">
        <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          value={value ?? ""}
          placeholder={nullable ? "auto" : ""}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value === "" && nullable ? null : e.target.value)}
        />
      </span>
      <span className="swatches">
        {["#000000", ...PALETTE].map((c) => (
          <button
            key={c}
            type="button"
            className={c === value ? "swatch active" : "swatch"}
            style={{ background: c }}
            title={c}
            onClick={(e) => {
              e.preventDefault();
              onChange(c);
            }}
          />
        ))}
      </span>
    </Row>
  );
}

export const LINESTYLES = [null, "-", "--", ":", "-."] as const;
export const MARKERS = [null, "o", "s", "^", "v", "D", "x", "+", "*", "."] as const;
export const HATCHES = [null, "////", "\\\\\\\\", "xxxx", "....", "||||", "----"] as const;
export const LEGEND_LOCS = [
  "best", "upper right", "upper left", "lower left", "lower right", "right",
  "center left", "center right", "lower center", "upper center", "center",
];
