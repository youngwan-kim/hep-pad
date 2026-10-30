"""Helpers copied verbatim into generated scripts.

Every function here must be self-contained: it may only use ``np``, ``uproot``,
``namedtuple``, other helpers from this module, and the script globals
``BASE`` and ``INPUTS``. The code generator copies the source of the helpers a
plot needs into the script, and the editor executes the same code, so what the
editor shows is exactly what the exported script draws.
"""

from collections import namedtuple

import numpy as np
import uproot

BASE = None  # set by the script
INPUTS = {}  # set by the script

Hist1D = namedtuple("Hist1D", "edges values variances")


def read(file, path, tree=None):
    """Read a TH1, TH2 or TGraph into a dict of numpy arrays (flow bins included).

    With ``tree``, ``path`` is a TTree and the histogram is filled from it (see ``read_tree``).
    """
    if tree is not None:
        return read_tree(file, path, tree)
    with uproot.open(file) as f:
        obj = f[path]
        cls = obj.classname
        if cls.startswith("TH2"):
            values = obj.values(flow=True)
            var = obj.variances(flow=True)
            return {"kind": "h2", "xedges": obj.axis(0).edges(), "yedges": obj.axis(1).edges(),
                    "values": values, "variances": values if var is None else var}
        if cls.startswith(("TH1", "TProfile")):
            values = obj.values(flow=True)
            var = obj.variances(flow=True)
            return {"kind": "h1", "edges": obj.axis().edges(),
                    "values": values, "variances": values if var is None else var}
        if cls.startswith("TGraph"):
            x, y = obj.values(axis="both")
            try:
                (xl, yl), (xh, yh) = obj.errors("low", axis="both"), obj.errors("high", axis="both")
            except Exception:
                xl = xh = yl = yh = np.zeros(len(x))
            return {"kind": "graph", "x": x, "y": y, "xerr": [xl, xh], "yerr": [yl, yh]}
        raise TypeError(f"{path!r} is a {cls}; expected TH1, TH2 or TGraph")


def tree_columns(ttree, exprs, entry_stop=None):
    """Evaluate expressions of a TTree's branches chunk by chunk.

    Yields one list of awkward arrays (one per expression) per chunk. Expressions
    are Python with branch names, a few numpy/awkward functions, and ROOT-style
    ``&&``, ``||``, ``!``, which act elementwise like ``&``, ``|``, ``~`` but keep
    their low precedence (``a > 1 && b < 2``); ``lo < x < hi`` also works.
    """
    import ast
    import functools
    import re

    import awkward as ak

    funcs = {name: getattr(np, name) for name in (
        "abs", "sqrt", "exp", "log", "log10", "sin", "cos", "tan", "arctan2", "sinh", "cosh",
        "tanh", "minimum", "maximum", "where", "pi")}
    for name in ("sum", "max", "min", "any", "all", "count"):
        funcs[name] = functools.partial(getattr(ak, name), axis=-1)  # per event
    funcs["num"] = functools.partial(ak.num, axis=-1)
    branches = set(ttree.keys(recursive=True))
    where = ttree.object_path.split(";")[0].lstrip("/")
    aliases = {}

    def alias(branch):
        return aliases.setdefault(branch, f"_b{len(aliases)}")

    def chain(op, values):
        return functools.reduce(lambda a, b: ast.BinOp(a, op, b), values)

    class Compile(ast.NodeTransformer):
        def visit_BoolOp(self, node):
            self.generic_visit(node)
            return chain(ast.BitAnd() if isinstance(node.op, ast.And) else ast.BitOr(), node.values)

        def visit_UnaryOp(self, node):
            self.generic_visit(node)
            return ast.UnaryOp(ast.Invert(), node.operand) if isinstance(node.op, ast.Not) else node

        def visit_Compare(self, node):
            self.generic_visit(node)
            sides = [node.left, *node.comparators]
            pairs = [ast.Compare(a, [op], [b]) for a, op, b in zip(sides, node.ops, sides[1:])]
            return pairs[0] if len(pairs) == 1 else chain(ast.BitAnd(), pairs)

        def visit_Attribute(self, node):  # dotted branch names, e.g. "Muon.pt"
            name = ast.unparse(node)
            if name not in branches:
                raise KeyError(f"no branch {name!r} in tree {where!r}")
            return ast.Name(alias(name), ast.Load())

        def visit_Name(self, node):
            if node.id in branches:
                return ast.Name(alias(node.id), ast.Load())
            if node.id in funcs:
                return node
            raise KeyError(f"no branch {node.id!r} in tree {where!r}")

    codes = []
    for expr in exprs:
        text = re.sub(r"!(?!=)", " not ", expr.replace("&&", " and ").replace("||", " or "))
        try:
            parsed = ast.parse(text.strip(), mode="eval")
        except SyntaxError as exc:
            raise ValueError(f"cannot parse expression {expr!r}: {exc.msg}") from None
        codes.append(compile(ast.fix_missing_locations(Compile().visit(parsed)), expr, "eval"))
    if not aliases:
        raise ValueError(f"expressions {exprs} use no branches of {where!r}")
    for chunk in ttree.iterate(list(aliases), library="ak", how=dict, step_size="100 MB",
                               entry_stop=entry_stop):
        names = {**funcs, **{aliases[b]: chunk[b] for b in aliases}}
        yield [eval(code, {"__builtins__": {}}, names) for code in codes]


def read_tree(file, path, tree):
    """Fill a histogram from the TTree ``path``, as ROOT's TTree::Draw would.

    ``tree`` holds ``expr``, ``bins`` and optionally ``cut``, ``weight`` (see
    ``tree_columns``) and ``yexpr``/``ybins`` for 2D. ``bins`` is ``[n, lo, hi]`` or a
    list of edges. Jagged values, cuts and weights broadcast against each other per event.
    """
    import awkward as ak

    def edges(bins):
        return np.linspace(bins[1], bins[2], int(bins[0]) + 1) if len(bins) == 3 else np.asarray(bins, float)

    axes = [tree["expr"]] + ([tree["yexpr"]] if tree.get("yexpr") else [])
    all_edges = [edges(tree["bins"])] + ([edges(tree["ybins"])] if len(axes) == 2 else [])
    shape = tuple(len(e) + 1 for e in all_edges)  # regular bins plus under- and overflow
    values, variances = np.zeros(shape).ravel(), np.zeros(shape).ravel()
    exprs = [*axes, tree.get("cut") or "True", tree.get("weight") or "1.0"]
    with uproot.open(file) as f:
        for *cols, keep, w in tree_columns(f[path], exprs):
            *cols, keep, w = ak.broadcast_arrays(*cols, keep, w)
            # Missing values (e.g. max() of an event without muons) are skipped, like cut ones.
            keep = ak.fill_none(keep, False)
            for col in cols:
                keep = keep & ~ak.is_none(col, axis=-1)
            w = ak.to_numpy(ak.flatten(w[keep], axis=None)).astype(np.float64)
            # Bin i covers [edge[i-1], edge[i]); bin 0 is underflow, the last is overflow.
            index = np.zeros(len(w), dtype=np.int64)
            for col, e, n in zip(cols, all_edges, shape):
                x = ak.to_numpy(ak.flatten(col[keep], axis=None)).astype(np.float64)
                index = index * n + np.searchsorted(e, x, side="right")
            values += np.bincount(index, weights=w, minlength=values.size)
            variances += np.bincount(index, weights=w**2, minlength=values.size)
    values, variances = values.reshape(shape), variances.reshape(shape)
    if len(axes) == 2:
        return {"kind": "h2", "xedges": all_edges[0], "yedges": all_edges[1],
                "values": values, "variances": variances}
    return {"kind": "h1", "edges": all_edges[0], "values": values, "variances": variances}


def load(key, path, kind, tree=None):
    file = INPUTS.get(key, key)
    obj = read(file if BASE is None or "://" in file else BASE / file, path, tree)
    if obj["kind"] != kind:
        raise TypeError(f"{path!r} is a {obj['kind']}, expected {kind}")
    return obj


def hist1d(refs, flow="none", rebin=None, xrange=None, scale=1.0, normalize=False):
    """Sum the 1D histograms ``refs`` [(input, path[, tree]), ...] and apply the given operations."""
    objs = [load(ref[0], ref[1], "h1", *ref[2:]) for ref in refs]
    edges = objs[0]["edges"]
    for o in objs[1:]:
        if len(o["edges"]) != len(edges) or not np.allclose(o["edges"], edges):
            raise ValueError("cannot add histograms with different binning")
    values = np.sum([o["values"] for o in objs], axis=0).astype(float)
    variances = np.sum([o["variances"] for o in objs], axis=0).astype(float)
    if flow == "fold":
        values[1] += values[0]
        values[-2] += values[-1]
        variances[1] += variances[0]
        variances[-2] += variances[-1]
    values, variances = values[1:-1], variances[1:-1]
    if rebin is not None:
        if isinstance(rebin, int):
            # A trailing partial group is dropped, as in ROOT's TH1::Rebin.
            idx = np.arange(0, len(values) + 1, max(rebin, 1))
        else:
            idx = np.array([int(np.argmin(np.abs(edges - e))) for e in rebin])
            if not np.allclose(edges[idx], rebin):
                raise ValueError(f"rebin edges {rebin} are not existing bin edges")
            if len(idx) < 2 or np.any(np.diff(idx) <= 0):
                raise ValueError("rebin edges must be increasing")
        lo, hi = idx[0], idx[-1]
        values = np.add.reduceat(values[lo:hi], idx[:-1] - lo)
        variances = np.add.reduceat(variances[lo:hi], idx[:-1] - lo)
        edges = edges[idx]
    if xrange is not None:
        keep = (edges[:-1] >= xrange[0] - 1e-12) & (edges[1:] <= xrange[1] + 1e-12)
        if not keep.any():
            raise ValueError(f"xrange {xrange} contains no complete bins")
        first, last = np.flatnonzero(keep)[[0, -1]]
        edges, values, variances = edges[first:last + 2], values[first:last + 1], variances[first:last + 1]
    if normalize and values.sum():
        scale = scale / values.sum()
    return Hist1D(edges, values * scale, variances * scale**2)


def add(hists):
    """Bin-by-bin sum of Hist1Ds with identical binning."""
    for h in hists[1:]:
        if len(h.edges) != len(hists[0].edges) or not np.allclose(h.edges, hists[0].edges):
            raise ValueError("cannot add histograms with different binning")
    return Hist1D(hists[0].edges, np.sum([h.values for h in hists], axis=0),
                  np.sum([h.variances for h in hists], axis=0))


def auto_yerr(h):
    """Poisson (Garwood) errors for unweighted counts, sqrt(sumw2) otherwise."""
    return True if np.allclose(h.variances, h.values) else np.sqrt(h.variances)


def ratio(num, den):
    """num/den with num's errors scaled by 1/den, and den's relative error (NaN where den == 0)."""
    if len(num.edges) != len(den.edges) or not np.allclose(num.edges, den.edges):
        raise ValueError("ratio: binning differs")
    with np.errstate(divide="ignore", invalid="ignore"):
        safe = np.where(den.values != 0, den.values, np.nan)
        return num.values / safe, np.sqrt(num.variances) / safe, np.sqrt(den.variances) / safe


def pull(num, den):
    """(num - den) / sqrt(var_num + var_den), 0 where both variances vanish."""
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma = np.sqrt(num.variances + den.variances)
        return np.where(sigma > 0, (num.values - den.values) / sigma, 0.0)


def hist2d(refs, scale=1.0, cmin=None):
    """Sum 2D histograms; returns (xedges, yedges, values) without flow bins."""
    objs = [load(ref[0], ref[1], "h2", *ref[2:]) for ref in refs]
    values = np.sum([o["values"] for o in objs], axis=0)[1:-1, 1:-1] * scale
    if cmin is not None:
        values = np.where(values < cmin, np.nan, values)
    return objs[0]["xedges"], objs[0]["yedges"], values


def object_paths(key):
    """Paths of all objects in an input file."""
    file = INPUTS.get(key, key)
    with uproot.open(file if BASE is None or "://" in file else BASE / file) as f:
        return list(f.classnames(cycle=False, recursive=True))


Syst = namedtuple("Syst", "down up sources missing")


def systematics(components, common=(), symmetrize="none"):
    """Bin-by-bin systematic uncertainty of the sum of ``components``.

    ``components``: [{"refs": [(input, path), ...], "ops": {hist1d options},
    "syst": [systematic, ...]}, ...]; ``common`` systematics apply to every
    component. The shifts of one source add linearly across components (fully
    correlated); sources add in quadrature. Per source and bin, the up (down)
    error is the largest upward (downward) shift of its variations.
    Returns absolute ``down``/``up`` errors, ``sources`` {name: (down, up)} and
    ``missing`` [(source, path)] for variations that were not found.
    """
    import re

    shifts, missing, listings = {}, [], {}

    def add_shift(source, variation, delta):
        per_source = shifts.setdefault(source, {})
        per_source[variation] = per_source.get(variation, 0) + delta

    def fill(template, path, **extra):
        directory, _, name = path.rpartition("/")
        return template.format(path=path, dir=directory, name=name, **extra)

    for comp in components:
        ops = comp.get("ops", {})
        raw = dict(ops, scale=1.0, normalize=False)
        nominal = hist1d(comp["refs"], **raw)
        # Variations get the nominal's scale factor, so normalization effects survive.
        factor = ops.get("scale", 1.0)
        if ops.get("normalize") and nominal.values.sum():
            factor /= nominal.values.sum()
        nominal_values = nominal.values * factor

        def varied(file, template, label, **extra):
            refs = [(file or key, fill(template, path, **extra), *tree) for key, path, *tree in comp["refs"]]
            try:
                return hist1d(refs, **raw).values * factor - nominal_values
            except KeyError:  # the variation does not exist for this component
                missing.append((label, refs[0][1]))
                return None

        for syst in [*common, *comp.get("syst", [])]:
            kind = syst["kind"]
            if kind == "norm":
                add_shift(syst["source"], "up", nominal_values * syst["up"])
                down = syst["up"] if syst.get("down") is None else syst["down"]
                add_shift(syst["source"], "down", -nominal_values * down)
            elif kind == "envelope":
                for variation in syst["variations"]:
                    delta = varied(syst.get("file"), syst.get("path", "{path}_{variation}"),
                                   f"{syst['source']} ({variation})", variation=variation)
                    if delta is not None:
                        add_shift(syst["source"], variation, delta)
            elif kind == "shape":
                up = syst.get("up", "{path}_{source}Up")
                down = syst.get("down", "{path}_{source}Down")
                sources = syst.get("sources")
                if sources is None:
                    # Discover sources: every object matching the up template.
                    file = syst.get("file") or comp["refs"][0][0]
                    if file not in listings:
                        listings[file] = object_paths(file)
                    pattern = re.escape(fill(up, comp["refs"][0][1], source="\0"))
                    pattern = "^" + pattern.replace("\0", "(?P<source>[^/]+?)") + "$"
                    sources = sorted({m["source"] for p in listings[file] if (m := re.match(pattern, p))})
                for source in sources:
                    if any(re.search(x, source) for x in syst.get("exclude", [])):
                        continue
                    delta_up = varied(syst.get("file"), up, f"{source} up", source=source)
                    if delta_up is None:
                        continue
                    delta_down = (varied(syst.get("file"), down, f"{source} down", source=source)
                                  if down else None)
                    add_shift(source, "up", delta_up)
                    # Without a down variation, mirror the up shift.
                    add_shift(source, "down", -delta_up if delta_down is None else delta_down)
            else:
                raise ValueError(f"unknown systematic kind {kind!r}")

    n = len(nominal_values) if components else 0
    total_down, total_up, breakdown = np.zeros(n), np.zeros(n), {}
    for source, variations in shifts.items():
        deltas = np.array([np.broadcast_to(d, (n,)) for d in variations.values()])
        up = np.maximum(deltas.max(axis=0), 0)
        down = np.maximum(-deltas.min(axis=0), 0)
        if symmetrize == "max":
            up = down = np.maximum(up, down)
        elif symmetrize == "average":
            up = down = (up + down) / 2
        breakdown[source] = (down, up)
        total_down += down**2
        total_up += up**2
    return Syst(np.sqrt(total_down), np.sqrt(total_up), breakdown, missing)


def group_sources(names, groups):
    """Assign source names to ``groups`` ({group: [regex, ...]}); the rest go to "Other"."""
    import re

    out = {g: [n for n in names if any(re.search(p, n) for p in patterns)]
           for g, patterns in groups.items()}
    grouped = {n for members in out.values() for n in members}
    other = [n for n in names if n not in grouped]
    if other:
        out["Other"] = out.get("Other", []) + other
    return out


def band_errors(h, syst, include, groups=None):
    """Absolute (down, up) errors of ``h`` combining ``include`` in quadrature.

    Items: "stat", "syst" (every source), a group from ``groups`` ("Other" for
    ungrouped sources) or a single source name. Each source counts once.
    """
    sources = syst.sources if syst is not None else {}
    by_group = group_sources(list(sources), groups or {})
    chosen = set()
    for item in include:
        if item == "syst":
            chosen |= set(sources)
        elif item in by_group:
            chosen |= set(by_group[item])
        elif item in sources:
            chosen.add(item)
    down2 = np.zeros_like(h.values, dtype=float)
    up2 = np.zeros_like(h.values, dtype=float)
    for name in chosen:
        down2 += sources[name][0] ** 2
        up2 += sources[name][1] ** 2
    if "stat" in include:
        down2 += h.variances
        up2 += h.variances
    return np.sqrt(down2), np.sqrt(up2)


def sort_legend(handles, labels, order=None, reverse=False):
    """Reverse, then order entries by ``order`` (labels); unlisted entries keep draw order."""
    entries = list(zip(handles, labels))[:: -1 if reverse else 1]
    if order:
        rank = {label: i for i, label in enumerate(order)}
        entries.sort(key=lambda e: rank.get(e[1], len(rank)))
    return [e[0] for e in entries], [e[1] for e in entries]


# Helper dependencies, so the generator can copy exactly what a script needs.
DEPENDS = {
    "hist1d": ["load", "Hist1D"],
    "hist2d": ["load"],
    "load": ["read"],
    "read": ["read_tree"],
    "read_tree": ["tree_columns"],
    "add": ["Hist1D"],
    "systematics": ["hist1d", "object_paths", "Syst"],
    "band_errors": ["group_sources"],
}
