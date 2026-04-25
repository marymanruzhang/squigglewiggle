"""
Rule-based sketch interaction engine.

generate_interaction_gif(gif_a, gif_b, cat_a, cat_b, output_path)
  → composites two animated GIFs on a shared stage where:
      Phase 1 (first half):  both animate independently in their corners
      Phase 2 (second half): one "actor" moves toward the other with easing

The INTERACTION_TABLE maps frozenset({cat_a, cat_b}) to (actor, behavior).
  actor:    which category moves toward the other
  behavior: string hint for future richer motion (currently drives direction)

Unknown pairs default to: the left sketch drifts toward the right one.
"""

from __future__ import annotations

import math
from PIL import Image
import numpy as np


# ---------------------------------------------------------------------------
# Interaction table
# ---------------------------------------------------------------------------

# frozenset({cat_a, cat_b}) → (actor_category, behavior_label)
# actor_category: which sketch moves toward the other
# behavior_label: future extensibility (circling, chasing, landing, …)
_INTERACTION_TABLE: dict[frozenset, tuple[str, str]] = {
    frozenset({"bird",      "flower"}):   ("bird",      "land"),
    frozenset({"bird",      "tree"}):     ("bird",      "land"),
    frozenset({"bird",      "worm"}):     ("bird",      "peck"),
    frozenset({"bird",      "cat"}):      ("bird",      "flee"),
    frozenset({"butterfly", "flower"}):   ("butterfly", "land"),
    frozenset({"butterfly", "tree"}):     ("butterfly", "land"),
    frozenset({"bee",       "flower"}):   ("bee",       "circle"),
    frozenset({"bee",       "tree"}):     ("bee",       "circle"),
    frozenset({"dog",       "cat"}):      ("dog",       "chase"),
    frozenset({"dog",       "bone"}):     ("dog",       "fetch"),
    frozenset({"cat",       "mouse"}):    ("cat",       "chase"),
    frozenset({"cat",       "fish"}):     ("cat",       "pounce"),
    frozenset({"fish",      "shark"}):    ("fish",      "flee"),
    frozenset({"fish",      "hook"}):     ("fish",      "flee"),
    frozenset({"sun",       "cloud"}):    ("cloud",     "drift"),
    frozenset({"moon",      "star"}):     ("star",      "orbit"),
    frozenset({"rabbit",    "carrot"}):   ("rabbit",    "fetch"),
    frozenset({"frog",      "fly"}):      ("frog",      "pounce"),
    frozenset({"snake",     "mouse"}):    ("snake",     "chase"),
    frozenset({"horse",     "rider"}):    ("horse",     "land"),
    frozenset({"penguin",   "fish"}):     ("penguin",   "pounce"),
    frozenset({"owl",       "mouse"}):    ("owl",       "pounce"),
    frozenset({"spider",    "fly"}):      ("spider",    "chase"),
}

# Sketch categories considered "stationary" (do not move toward the other)
_STATIONARY: frozenset[str] = frozenset({
    "flower", "tree", "house", "mountain", "castle", "cactus",
    "mushroom", "grass", "sun", "moon", "star", "cloud", "rainbow",
    "streetlight", "lighthouse", "barn",
})


def _get_behavior(cat_a: str, cat_b: str) -> tuple[str, str]:
    """Return (actor_category, behavior_label) for the pair."""
    key = frozenset({cat_a.lower(), cat_b.lower()})
    if key in _INTERACTION_TABLE:
        return _INTERACTION_TABLE[key]

    # Default: prefer the non-stationary one as actor; if both same → cat_a
    a_static = cat_a.lower() in _STATIONARY
    b_static  = cat_b.lower() in _STATIONARY
    if b_static and not a_static:
        return (cat_a, "approach")
    if a_static and not b_static:
        return (cat_b, "approach")
    return (cat_a, "approach")   # left sketch moves right by default


def _load_gif_frames(path: str) -> list[Image.Image]:
    """Extract all frames from a GIF as RGB PIL images."""
    frames: list[Image.Image] = []
    gif = Image.open(path)
    try:
        while True:
            frames.append(gif.copy().convert("RGB"))
            gif.seek(gif.tell() + 1)
    except EOFError:
        pass
    return frames if frames else [gif.convert("RGB")]


def _make_transparent(frame_rgb: Image.Image, thresh: int = 230) -> Image.Image:
    """Convert near-white pixels to transparent (RGBA)."""
    rgba = frame_rgb.convert("RGBA")
    data = np.array(rgba, dtype=np.uint8)
    white = (data[:, :, 0] > thresh) & (data[:, :, 1] > thresh) & (data[:, :, 2] > thresh)
    data[white, 3] = 0
    return Image.fromarray(data, "RGBA")


def _ease_in_out(t: float) -> float:
    """Smooth cubic ease-in-out: t in [0,1] → eased value in [0,1]."""
    return t * t * (3.0 - 2.0 * t)


def generate_interaction_gif(
    gif_a_path: str,
    gif_b_path: str,
    cat_a: str,
    cat_b: str,
    output_path: str,
    n_frames: int = 48,
    fps: int = 12,
) -> str:
    """
    Composite two animated GIFs into a shared-stage interaction GIF.

    Layout
    ------
    Stage is 900 × 460 px with a white background.
    Sketch A is placed on the LEFT, sketch B on the RIGHT.
    Each sketch is scaled to fit inside a 340 × 340 thumbnail.

    Phases
    ------
    Phase 1 (frames 0 … n_static-1): both animate in place.
    Phase 2 (frames n_static … n_frames-1): actor drifts toward the target
        using a smooth ease-in-out curve.  The actor's animation loop
        continues playing during movement.
    """
    frames_a = _load_gif_frames(gif_a_path)
    frames_b = _load_gif_frames(gif_b_path)

    CANVAS_W, CANVAS_H = 900, 460
    THUMB = 340   # max width/height for each sketch thumbnail

    # Resize to thumbnail — keep aspect ratio
    def _thumb(fr_list: list[Image.Image]) -> list[Image.Image]:
        out = []
        for f in fr_list:
            f.thumbnail((THUMB, THUMB), Image.LANCZOS)
            out.append(f)
        return out

    frames_a = _thumb(frames_a)
    frames_b = _thumb(frames_b)

    # Centred positions within each half (left half: 0…450, right half: 450…900)
    def _centre_pos(thumb_w: int, thumb_h: int, half_x_start: int) -> tuple[int, int]:
        cx = half_x_start + (450 - thumb_w) // 2
        cy = (CANVAS_H - thumb_h) // 2
        return cx, cy

    wa, ha = frames_a[0].size
    wb, hb = frames_b[0].size
    start_ax, start_ay = _centre_pos(wa, ha, 0)
    start_bx, start_by = _centre_pos(wb, hb, 450)

    # Determine actor
    actor_cat, behavior = _get_behavior(cat_a, cat_b)
    actor_is_a = actor_cat.lower() == cat_a.lower()

    # Target position: actor ends up just touching the other sketch
    if actor_is_a:
        # A moves right toward B
        target_ax = start_bx - wa - 10
        target_ay = start_by + (hb - ha) // 2   # vertical align centres
        target_bx, target_by = start_bx, start_by
    else:
        # B moves left toward A
        target_bx = start_ax + wa + 10
        target_by = start_ay + (ha - hb) // 2
        target_ax, target_ay = start_ax, start_ay

    n_static = n_frames // 2

    result_frames: list[Image.Image] = []
    for fi in range(n_frames):
        canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), (255, 255, 255))

        fa = frames_a[fi % len(frames_a)]
        fb = frames_b[fi % len(frames_b)]

        if fi < n_static:
            ax, ay = start_ax, start_ay
            bx, by = start_bx, start_by
        else:
            raw_t = (fi - n_static) / max(n_frames - n_static - 1, 1)
            t = _ease_in_out(min(raw_t, 1.0))
            if actor_is_a:
                ax = int(start_ax + (target_ax - start_ax) * t)
                ay = int(start_ay + (target_ay - start_ay) * t)
                bx, by = start_bx, start_by
            else:
                bx = int(start_bx + (target_bx - start_bx) * t)
                by = int(start_by + (target_by - start_by) * t)
                ax, ay = start_ax, start_ay

        # Paste with transparency masking so white backgrounds don't block
        fa_rgba = _make_transparent(fa)
        fb_rgba = _make_transparent(fb)
        canvas.paste(fa_rgba, (ax, ay), mask=fa_rgba.split()[3])
        canvas.paste(fb_rgba, (bx, by), mask=fb_rgba.split()[3])

        result_frames.append(canvas)

    duration_ms = int(1000 / fps)
    result_frames[0].save(
        output_path,
        format="GIF",
        save_all=True,
        append_images=result_frames[1:],
        loop=0,
        duration=duration_ms,
        optimize=False,
    )
    return output_path
