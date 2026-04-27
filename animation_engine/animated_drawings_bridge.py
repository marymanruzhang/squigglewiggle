"""
animation_engine/animated_drawings_bridge.py
─────────────────────────────────────────────────────────────────────────────
Phase 3: Meta AnimatedDrawings integration.

Takes a PIL RGBA image + label + GPT-detected joints and produces
frame-by-frame PIL RGBA images of a walk/run/jump/dance cycle using
Meta's ARAP (As-Rigid-As-Possible) mesh deformation.

Falls back gracefully if AnimatedDrawings is not installed (Python 3.8
is required by the library; the current venv may differ).

BVH motion selection by motion_hint:
  "walk"   → walk_back_and_forth_in_place.bvh
  "run"    → run_in_place.bvh
  "jump"   → jumping.bvh
  "dance"  → zombie.bvh  (expressive full-body)
  "idle"   → breathing_+_looking.bvh
"""

from __future__ import annotations

import os
import io
import uuid
import tempfile
import hashlib
import yaml
from pathlib import Path
from PIL import Image
import numpy as np

# ─── Frame cache ─────────────────────────────────────────────────────────────
# key: (label, motion, joints_hash) → list[PIL.Image RGBA]
_frame_cache: dict = {}


def _joints_hash(joints: dict) -> str:
    """Stable hash of the joint dict for caching."""
    s = str(sorted(joints.items()))
    return hashlib.md5(s.encode()).hexdigest()[:8]


# ─── BVH motion map ──────────────────────────────────────────────────────────
# Maps motion hints to AnimatedDrawings built-in BVH file names.
# The BVH files live inside the installed animated_drawings package under
# animated_drawings/data/retarget_configs and motion configs.

_MOTION_BVH_MAP = {
    "walk":   "walk_back_and_forth_in_place.yaml",
    "run":    "run_in_place.yaml",
    "jump":   "jumping.yaml",
    "dance":  "zombie.yaml",
    "bounce": "jumping.yaml",
    "idle":   "breathing_+_looking.yaml",
    "fly":    "zombie.yaml",  # expressive substitute for flying
    "swim":   "walk_back_and_forth_in_place.yaml",
}

def _get_motion_config_name(motion: str) -> str:
    return _MOTION_BVH_MAP.get(motion, _MOTION_BVH_MAP["walk"])


# ─── Character type → retarget config ────────────────────────────────────────

_BIPED_LABELS = {
    "human", "person", "man", "woman", "stick figure", "boy", "girl"
}
_QUADRUPED_LABELS = {
    "dog", "cat", "horse", "cow", "sheep", "rabbit", "elephant", "bear",
    "lion", "tiger", "giraffe", "fox", "deer", "pig", "wolf", "mouse",
    "turtle", "tortoise", "frog", "lizard", "kangaroo",
}

def _get_retarget_config(label: str) -> str:
    """Return the retarget config yaml name for this label."""
    lbl = label.lower()
    if lbl in _BIPED_LABELS:
        return "fair1_ppf.yaml"
    if lbl in _QUADRUPED_LABELS:
        return "fair1_ppf.yaml"   # AnimatedDrawings uses same retarget for quadrupeds via joint mapping
    return "fair1_ppf.yaml"


# ─── Annotation builder ───────────────────────────────────────────────────────

def _build_char_cfg(img_rgba: Image.Image, joints: dict, work_dir: str) -> str:
    """
    Write the character annotation files that AnimatedDrawings expects:
      <work_dir>/texture.png    — RGBA character image
      <work_dir>/mask.png       — binary mask (alpha > 0)
      <work_dir>/char_cfg.yaml  — joint positions + metadata

    Returns the path to char_cfg.yaml.
    """
    W, H = img_rgba.size

    # texture.png — the full RGBA sketch
    texture_path = os.path.join(work_dir, "texture.png")
    img_rgba.save(texture_path)

    # mask.png — binary mask derived from alpha channel
    arr  = np.array(img_rgba)
    mask = (arr[:, :, 3] > 20).astype(np.uint8) * 255
    mask_img = Image.fromarray(mask, "L")
    mask_path = os.path.join(work_dir, "mask.png")
    mask_img.save(mask_path)

    # Build bounding box from mask
    rows = np.where(mask > 0)
    if len(rows[0]) == 0:
        top, bottom, left, right = 0, H, 0, W
    else:
        top    = int(rows[0].min())
        bottom = int(rows[0].max())
        left   = int(rows[1].min())
        right  = int(rows[1].max())

    # Convert normalized [0–1] joints → pixel coords
    # Joints from /api/detect-joints are already normalized fractions
    joint_pixel = {}
    for name, coords in joints.items():
        if isinstance(coords, (list, tuple)) and len(coords) == 2:
            jx = int(float(coords[0]) * W)
            jy = int(float(coords[1]) * H)
            joint_pixel[name] = [jx, jy]

    # AnimatedDrawings char_cfg format
    char_cfg = {
        "height": H,
        "width":  W,
        "skeleton": [
            {"loc": joint_pixel.get(name, [W//2, H//2]), "name": name, "parent": _JOINT_PARENTS.get(name)}
            for name in _JOINT_ORDER
            if name in joint_pixel or name in _JOINT_ORDER
        ],
        "bbox": [left, top, right - left, bottom - top],
    }

    cfg_path = os.path.join(work_dir, "char_cfg.yaml")
    with open(cfg_path, "w") as f:
        yaml.dump(char_cfg, f, default_flow_style=False)

    return cfg_path


# AnimatedDrawings joint hierarchy (biped + quadruped shared names)
_JOINT_ORDER = [
    "root", "hip_L", "knee_L", "ankle_L",
    "hip_R", "knee_R", "ankle_R",
    "spine", "neck", "head",
    "shoulder_L", "elbow_L",
    "shoulder_R", "elbow_R",
]

_JOINT_PARENTS = {
    "root": None,
    "hip_L": "root",     "knee_L": "hip_L",   "ankle_L": "knee_L",
    "hip_R": "root",     "knee_R": "hip_R",   "ankle_R": "knee_R",
    "spine": "root",     "neck": "spine",      "head": "neck",
    "shoulder_L": "spine", "elbow_L": "shoulder_L",
    "shoulder_R": "spine", "elbow_R": "shoulder_R",
}


# ─── Public API ───────────────────────────────────────────────────────────────

def generate_ad_frames(
    img_rgba: Image.Image,
    label:    str,
    joints:   dict,
    motion:   str = "walk",
    n_frames: int = 24,
) -> list[Image.Image]:
    """
    Render a walk/run/etc. animation using Meta's AnimatedDrawings library.

    Parameters
    ----------
    img_rgba : PIL.Image  RGBA character image
    label    : str        e.g. "dog", "human"
    joints   : dict       normalized [0-1] joint positions from /api/detect-joints
    motion   : str        "walk" | "run" | "jump" | "dance" | "idle" | "fly" | "bounce"
    n_frames : int        number of output frames

    Returns
    -------
    list[PIL.Image]  RGBA frames (transparent background)

    Raises
    ------
    ImportError  if animated_drawings is not installed
    Exception    if rendering fails (caller should catch and fall back)
    """
    # Check cache first
    cache_key = (label, motion, _joints_hash(joints), n_frames)
    if cache_key in _frame_cache:
        return _frame_cache[cache_key]

    # Import animated_drawings — raises ImportError if not installed
    from animated_drawings import render as ad_render

    work_dir = tempfile.mkdtemp(prefix="squiggle_ad_")
    try:
        # 1. Write annotation files
        char_cfg_path = _build_char_cfg(img_rgba, joints, work_dir)

        # 2. Locate the built-in motion config within the installed package
        ad_pkg_dir = Path(ad_render.__file__).parent
        motion_cfg_name = _get_motion_config_name(motion)

        # AnimatedDrawings ships motion configs under examples/config/motion/
        # Try a few possible paths
        motion_cfg = None
        for candidate in [
            ad_pkg_dir.parent / "examples" / "config" / "motion" / motion_cfg_name,
            ad_pkg_dir / "data"  / "motion_configs"  / motion_cfg_name,
            ad_pkg_dir / "data"  / motion_cfg_name,
        ]:
            if candidate.exists():
                motion_cfg = str(candidate)
                break

        if not motion_cfg:
            raise FileNotFoundError(
                f"AnimatedDrawings motion config not found: {motion_cfg_name}. "
                "Please check your AnimatedDrawings installation."
            )

        retarget_cfg_name = _get_retarget_config(label)
        retarget_cfg = None
        for candidate in [
            ad_pkg_dir.parent / "examples" / "config" / "retarget" / retarget_cfg_name,
            ad_pkg_dir / "data" / "retarget_configs" / retarget_cfg_name,
            ad_pkg_dir / "data" / retarget_cfg_name,
        ]:
            if candidate.exists():
                retarget_cfg = str(candidate)
                break

        if not retarget_cfg:
            raise FileNotFoundError(
                f"AnimatedDrawings retarget config not found: {retarget_cfg_name}"
            )

        # 3. Build the scene YAML
        output_gif = os.path.join(work_dir, "output.gif")
        scene_cfg = {
            "scene": {
                "ANIMATED_CHARACTERS": [{
                    "character_cfg": char_cfg_path,
                    "motion_cfg":    motion_cfg,
                    "retarget_cfg":  retarget_cfg,
                }]
            },
            "view": {
                "USE_MESA": True,          # headless rendering (no display required)
                "RESOLUTION": [256, 256],
            },
            "controller": {
                "MODE": "video_render",
                "OUTPUT_VIDEO_PATH": output_gif,
            }
        }
        scene_cfg_path = os.path.join(work_dir, "scene.yaml")
        with open(scene_cfg_path, "w") as f:
            yaml.dump(scene_cfg, f, default_flow_style=False)

        # 4. Run the renderer
        ad_render.start(scene_cfg_path)

        # 5. Read output GIF frames
        if not os.path.exists(output_gif):
            raise RuntimeError("AnimatedDrawings produced no output GIF")

        gif = Image.open(output_gif)
        frames_out = []
        try:
            for frame_idx in range(n_frames):
                gif.seek(frame_idx % gif.n_frames)
                frame = gif.copy().convert("RGBA")
                frames_out.append(frame)
        except EOFError:
            pass  # fewer frames than requested — that's fine

        if not frames_out:
            raise RuntimeError("No frames extracted from AnimatedDrawings GIF")

        _frame_cache[cache_key] = frames_out
        return frames_out

    finally:
        # Clean up temp files
        import shutil
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
