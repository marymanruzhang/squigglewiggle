"""
Main animation pipeline.

Limb / character motion (Meta *AnimatedDrawings*-style 2D mesh) is selected when
`limb_bearing.should_use_limb_mesh` is true for the classifier label. All other
classes use the motion in `category_map` (sway, drift, swim, …).

Entry point: animate()

Recognition input format (two modes):

  Single object:
    {"category": "mushroom"}

  Multiple objects with bounding boxes:
    {"objects": [
        {"category": "sun",   "bbox": (x, y, w, h)},
        {"category": "cloud", "bbox": (x, y, w, h)},
    ]}

  Multiple objects — auto-segment (no bboxes needed):
    {"objects": [
        {"category": "sun"},
        {"category": "cloud"},
    ]}
    The pipeline segments the image and assigns categories in spatial order
    (top-to-bottom, left-to-right).
"""

import os
from PIL import Image

from .category_map import get_animation_type, AnimationType
from .animations import generate_frames, N_FRAMES, FPS
from .segmenter import segment_objects


def _save_gif(frames: list[Image.Image], path: str, fps: int = FPS) -> None:
    duration_ms = int(1000 / fps)
    frames[0].save(
        path,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=duration_ms,
        optimize=False,
    )


def _animate_whole_image(
    img: Image.Image,
    category: str,
    n_frames: int,
) -> list[Image.Image]:
    from .category_map import AnimationType
    anim_type = get_animation_type(category)
    if anim_type == AnimationType.SKELETAL:
        from .skeletal import generate_skeletal_frames
        return generate_skeletal_frames(img, n_frames)
    return generate_frames(img, anim_type, n_frames)


def _animate_multi_object(
    img: Image.Image,
    objects: list[dict],
    n_frames: int,
) -> list[Image.Image]:
    """
    Animate each object independently, composite back onto white canvas each frame.

    objects items may have:
      - "category": str
      - "bbox": (x, y, w, h)  ← optional; if absent, auto-segment is used

    When bboxes are absent the pipeline auto-segments and assigns categories
    to components in top-to-bottom / left-to-right order.
    """
    W, H = img.size

    # Determine whether bboxes are provided
    has_bboxes = all("bbox" in o for o in objects)

    if has_bboxes:
        components = []
        for o in objects:
            x, y, w, h = o["bbox"]
            crop = img.crop((x, y, x + w, y + h))
            components.append({
                "bbox": o["bbox"],
                "crop": crop,
                "category": o["category"],
            })
    else:
        # Auto-segment; assign categories by spatial order
        segments = segment_objects(img)
        categories = [o["category"] for o in objects]

        if len(segments) == 0:
            # Nothing detected — fall back to whole-image animation with first category
            cat = objects[0]["category"] if objects else "object"
            return _animate_whole_image(img, cat, n_frames)

        # Pair segments with categories (cycle if fewer categories than segments)
        components = []
        for idx, seg in enumerate(segments):
            cat = categories[idx % len(categories)]
            x, y, w, h = seg["bbox"]
            components.append({
                "bbox": (x, y, w, h),
                "crop": seg["crop"],
                "category": cat,
            })

    # Pre-generate all animated frame sequences per component
    animated = []
    for comp in components:
        anim_type = get_animation_type(comp["category"])
        if anim_type == AnimationType.SKELETAL:
            from .skeletal import generate_skeletal_frames
            comp_frames = generate_skeletal_frames(comp["crop"], n_frames)
        else:
            comp_frames = generate_frames(comp["crop"], anim_type, n_frames)
        animated.append((comp["bbox"], comp_frames))

    # Composite: for each frame index, paste each animated component onto white canvas
    result_frames = []
    for fi in range(n_frames):
        canvas = Image.new("RGB", (W, H), (255, 255, 255))
        for (x, y, w, h), comp_frames in animated:
            canvas.paste(comp_frames[fi], (x, y))
        result_frames.append(canvas)

    return result_frames


def animate(
    image_path: str,
    recognition: dict,
    output_path: str,
    n_frames: int = N_FRAMES,
    fps: int = FPS,
) -> str:
    """
    Animate a drawing and save as a GIF.

    Args:
        image_path:  Path to the source PNG.
        recognition: Dict from the recognition system (see module docstring).
        output_path: Where to write the output GIF.
        n_frames:    Animation loop length in frames (default 24 → 2 s at 12 fps).
        fps:         Playback speed.

    Returns:
        output_path
    """
    img = Image.open(image_path).convert("RGB")
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    if "category" in recognition:
        frames = _animate_whole_image(img, recognition["category"], n_frames)

    elif "objects" in recognition:
        frames = _animate_multi_object(img, recognition["objects"], n_frames)

    else:
        raise ValueError("recognition dict must have 'category' or 'objects' key")

    _save_gif(frames, output_path, fps)
    print(f"  saved → {output_path}")
    return output_path
