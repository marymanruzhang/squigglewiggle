"""
Geometric heuristic classifier for web-drawn sketches.

Used as a fallback when the CNN produces garbage (confident 'rain', 'line', etc.)
or overall confidence is very low. Analyses stroke geometry — not pixels — to
make a coarse category guess for the most commonly drawn objects.

NOT a replacement for a trained model. Just prevents obvious misclassifications
until the model is retrained.
"""

from __future__ import annotations

import math
from typing import Optional


def _stroke_stats(strokes: list) -> dict:
    """Compute geometric features from raw browser strokes."""
    if not strokes:
        return {}

    all_x = [float(x) for xs, ys in strokes for x in xs]
    all_y = [float(y) for xs, ys in strokes for y in ys]

    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    w  = max(max_x - min_x, 1.0)
    h  = max(max_y - min_y, 1.0)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2

    n_strokes = len(strokes)
    n_points  = sum(len(xs) for xs, ys in strokes)

    # Total arc length of all strokes
    arc_len = 0.0
    for xs, ys in strokes:
        for i in range(1, len(xs)):
            arc_len += math.hypot(xs[i] - xs[i-1], ys[i] - ys[i-1])

    # Curvature proxy: ratio of arc length to bounding box diagonal
    diag = math.hypot(w, h)
    curvature = arc_len / max(diag, 1.0)

    # Vertical bias: does the drawing extend more vertically than horizontally?
    aspect = h / max(w, 1.0)   # > 1 = tall, < 1 = wide

    # Stem check: is there a stroke that is mostly straight and vertical?
    has_vertical_stroke = False
    has_horizontal_stroke = False
    for xs, ys in strokes:
        if len(xs) < 2:
            continue
        dx = abs(max(xs) - min(xs))
        dy = abs(max(ys) - min(ys))
        if dy > 0 and dx / dy < 0.3 and dy > h * 0.25:
            has_vertical_stroke = True
        if dx > 0 and dy / dx < 0.3 and dx > w * 0.25:
            has_horizontal_stroke = True

    # Centroid of each stroke — check for bilateral symmetry (wings etc.)
    stroke_cx = [(min(xs) + max(xs)) / 2 for xs, ys in strokes]

    # How spread horizontally around canvas centre?
    left_strokes  = sum(1 for cx_s in stroke_cx if cx_s < cx - w * 0.15)
    right_strokes = sum(1 for cx_s in stroke_cx if cx_s > cx + w * 0.15)
    bilateral = min(left_strokes, right_strokes) / max(max(left_strokes, right_strokes), 1)

    # Roundness: for each stroke, ratio of min to max extent
    roundness_scores = []
    for xs, ys in strokes:
        sw = max(xs) - min(xs) + 1
        sh = max(ys) - min(ys) + 1
        roundness_scores.append(min(sw, sh) / max(sw, sh))
    avg_roundness = sum(roundness_scores) / max(len(roundness_scores), 1)

    # Check if single stroke that is mostly closed (start ≈ end)
    closed_strokes = 0
    for xs, ys in strokes:
        if len(xs) > 4:
            dist = math.hypot(xs[-1] - xs[0], ys[-1] - ys[0])
            stroke_len = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            if dist < stroke_len * 0.3:
                closed_strokes += 1

    return {
        "n_strokes":            n_strokes,
        "n_points":             n_points,
        "width":                w,
        "height":               h,
        "aspect":               aspect,
        "curvature":            curvature,
        "arc_len":              arc_len,
        "has_vertical_stroke":  has_vertical_stroke,
        "has_horizontal_stroke": has_horizontal_stroke,
        "bilateral":            bilateral,
        "avg_roundness":        avg_roundness,
        "closed_strokes":       closed_strokes,
        "left_strokes":         left_strokes,
        "right_strokes":        right_strokes,
    }


def heuristic_classify(strokes: list) -> Optional[tuple[str, float]]:
    """
    Return (category, confidence) based on stroke geometry, or None.
    Only fires when the pattern is VERY clear to avoid guessing wrong.
    """
    if not strokes:
        return None

    s = _stroke_stats(strokes)
    n  = s["n_strokes"]
    ar = s["aspect"]       # h/w
    cu = s["curvature"]
    bl = s["bilateral"]
    rn = s["avg_roundness"]
    cl = s["closed_strokes"]
    vt = s["has_vertical_stroke"]
    hz = s["has_horizontal_stroke"]

    # ── Butterfly / bird: bilateral symmetry + wide (ar < 0.85) ──────────
    if bl > 0.5 and ar < 0.90 and n >= 2:
        if ar < 0.70 and bl > 0.65:
            return ("butterfly", 62.0)
        return ("bird", 55.0)

    # ── Flower: has a vertical stroke (stem) + round top clusters ─────────
    if vt and rn > 0.45 and n >= 2 and ar > 0.9:
        return ("flower", 58.0)

    # ── Tree: vertical stroke + wide top, tall overall ────────────────────
    if vt and ar > 1.1 and n >= 2 and rn < 0.6:
        return ("tree", 55.0)

    # ── Sun: high roundness + many strokes radiating out ─────────────────
    if rn > 0.65 and n >= 4 and ar < 1.4 and ar > 0.7:
        return ("sun", 52.0)

    # ── Fish: wide aspect, single curved stroke ───────────────────────────
    if ar < 0.6 and n <= 3 and cu > 1.5:
        return ("fish", 52.0)

    # ── House: wide, moderate height, horizontal base ─────────────────────
    if hz and ar < 1.1 and ar > 0.5 and n >= 2:
        return ("house", 50.0)

    # ── Cloud: wide, low, multiple rounded humps ──────────────────────────
    if ar < 0.55 and rn > 0.5 and n >= 2:
        return ("cloud", 50.0)

    # ── Star: high curvature, moderate roundness, single or few strokes ───
    if cu > 3.0 and rn > 0.5 and n <= 2:
        return ("star", 52.0)

    # ── Snake/worm: very high curvature, single long stroke ───────────────
    if cu > 4.5 and n == 1:
        return ("snake", 50.0)

    return None
