from __future__ import annotations

import os
import io
import json
import base64
import uuid
import tensorflow as tf
from PIL import Image, ImageDraw
from flask import Flask, request, jsonify, send_from_directory
from animation_engine.pipeline import animate
from animation_engine.interaction import generate_interaction_gif
from sketch_preprocess import (
    pil_white_bg_to_model_tensor,
    strokes_to_quickdraw_tensor,
    predict_with_tta,
)
from gemini_classify import classify_with_gemini
from heuristic_classify import heuristic_classify

app = Flask(__name__, static_folder='static')
app.config['OUTPUT_FOLDER'] = 'output_api'
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

MODEL_PATH    = "sketch_model.keras"
CLASS_IDX_PATH = "class_indices.json"
_AUTO_FALLBACK = os.environ.get("HYPERSENSE_REQUIRE_MODEL", "").lower() not in (
    "1", "true", "yes",
)

model   = None
classes: dict | None = None


def _allow_without_classifier() -> bool:
    return _AUTO_FALLBACK


@app.before_request
def load_model():
    global model, classes
    if model is not None:
        return
    if os.path.exists(MODEL_PATH):
        try:
            model = tf.keras.models.load_model(MODEL_PATH, compile=False)
        except Exception as e:
            print("Error loading model:", e)
            model = None
    if model is not None and os.path.exists(CLASS_IDX_PATH):
        try:
            with open(CLASS_IDX_PATH, "r", encoding="utf-8") as f:
                classes = json.load(f)
        except Exception as e:
            print("Error loading class_indices:", e)
            classes = None


@app.route("/api/status", methods=["GET"])
def api_status():
    can_classify = (
        model is not None
        and isinstance(classes, dict)
        and len(classes) > 0
    )
    return jsonify(
        classifier=can_classify,
        use_category_hint=not can_classify and _allow_without_classifier(),
    )


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)


@app.route('/output/<path:filename>')
def serve_output(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _render_strokes_to_png(strokes, img_fallback: Image.Image, raw_path: str) -> None:
    """
    Render vector strokes to a white-background PNG at raw_path.
    This PNG is used by the ANIMATION pipeline (not classification).
    Strokes are drawn with natural line width for a good-looking GIF.
    """
    if strokes and len(strokes) > 0:
        min_x = min(min(x_arr) for x_arr, _y in strokes)
        max_x = max(max(x_arr) for x_arr, _y in strokes)
        min_y = min(min(y_arr) for _x, y_arr in strokes)
        max_y = max(max(y_arr) for _x, y_arr in strokes)
        width   = max(max_x - min_x, 1)
        height  = max(max_y - min_y, 1)
        max_dim = max(width, height)
        canvas_size = 384
        scale    = 320.0 / max_dim
        x_offset = (canvas_size - width  * scale) / 2
        y_offset = (canvas_size - height * scale) / 2
        # Natural-looking stroke width (used only for the animation GIF, not inference)
        line_w = max(3, min(8, int(0.018 * (width + height) * scale / max(1, len(strokes)))))
        rgb = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
        draw = ImageDraw.Draw(rgb)
        for x_arr, y_arr in strokes:
            pts = [
                ((x - min_x) * scale + x_offset, (y - min_y) * scale + y_offset)
                for x, y in zip(x_arr, y_arr)
            ]
            if len(pts) == 1:
                draw.ellipse(
                    (pts[0][0]-3, pts[0][1]-3, pts[0][0]+3, pts[0][1]+3),
                    fill=(0, 0, 0),
                )
            elif len(pts) > 1:
                draw.line(pts, fill=(0, 0, 0), width=line_w)
        rgb.save(raw_path)
    else:
        img = img_fallback
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3] if len(img.split()) == 4 else None)
            bg.save(raw_path)
        else:
            img.convert("RGB").save(raw_path)


_SPURIOUS = frozenset({
    "rain", "line", "zigzag", "squiggle", "stitches", "river", "string bean",
    "ocean", "animal migration", "spreadsheet", "calculator", "dresser",
    "passport", "map", "paintbrush", "tornado",
})
# These labels are ALWAYS suppressed — the CNN fires them on virtually every
# web-style drawing and they are never correct for normal user inputs.
_ALWAYS_SUPPRESS = frozenset({"rain", "animal migration", "stitches"})



def _classify(raw_path: str, strokes: list, hint: str | None):
    """
    Classify the sketch.

    Priority order:
      1. Gemini Vision    — best accuracy on web drawings (needs GOOGLE_API_KEY)
      2. CNN              — if confidence >= 30% AND label is not spurious
      3. Stroke heuristic — geometry rules for common objects
      4. CNN best-guess   — even if uncertain / spurious
      5. hint / default

    Returns (category, confidence_pct, top5_list).
    top5 items are dicts {"label": str, "conf": float}.
    """
    # ── 1. Gemini Vision ──────────────────────────────────────────────────
    gem = classify_with_gemini(raw_path)
    if gem is not None:
        cat, conf = gem
        print(f"  [Gemini] → {cat} ({conf:.0f}%)")
        return cat, conf, [{"label": cat, "conf": conf}]

    # ── 2 & 4. Local CNN ──────────────────────────────────────────────────
    can_classify = model is not None and isinstance(classes, dict) and len(classes) > 0
    cnn_cat, cnn_conf, cnn_top5 = None, 0.0, []

    if can_classify:
        if strokes and len(strokes) > 0:
            arr = strokes_to_quickdraw_tensor(strokes)
        else:
            arr = pil_white_bg_to_model_tensor(Image.open(raw_path).convert("RGB"))

        _, cnn_cat, cnn_conf, raw_top5 = predict_with_tta(model, arr, classes)
        cnn_top5 = [{"label": l, "conf": round(c, 1)} for l, c in raw_top5]

        # Also try PNG path if vector-stroke confidence is low
        if cnn_conf < 30.0 and strokes and len(strokes) > 0:
            arr2 = pil_white_bg_to_model_tensor(Image.open(raw_path).convert("RGB"))
            _, c2, conf2, rt2 = predict_with_tta(model, arr2, classes)
            if conf2 > cnn_conf:
                cnn_cat, cnn_conf = c2, conf2
                cnn_top5 = [{"label": l, "conf": round(c, 1)} for l, c in rt2]

        # Strip always-suppressed labels out of cnn_top5 entirely
        cnn_top5 = [x for x in cnn_top5 if x["label"].lower() not in _ALWAYS_SUPPRESS]
        if cnn_cat.lower() in _ALWAYS_SUPPRESS:
            # Pick next best non-suppressed CNN label
            cnn_cat = cnn_top5[0]["label"] if cnn_top5 else ""
            cnn_conf = cnn_top5[0]["conf"] if cnn_top5 else 0.0

        print(f"  [CNN] → {cnn_cat} ({cnn_conf:.1f}%)")

        # Accept CNN if confident enough and non-spurious
        if cnn_conf >= 50.0 and cnn_cat and cnn_cat.lower() not in _SPURIOUS:
            return cnn_cat, cnn_conf, cnn_top5


    # ── 3. Stroke geometry heuristic ─────────────────────────────────────
    if strokes and len(strokes) > 0:
        geo = heuristic_classify(strokes)
        if geo is not None:
            g_cat, g_conf = geo
            print(f"  [Heuristic] → {g_cat} ({g_conf:.0f}%)")
            top5 = [{"label": g_cat, "conf": g_conf}]
            for item in cnn_top5:   # append non-spurious CNN suggestions
                if item["label"].lower() not in _SPURIOUS and item["label"] != g_cat:
                    top5.append(item)
                if len(top5) >= 5:
                    break
            return g_cat, g_conf, top5

    # ── 4. CNN best-guess (even if spurious / uncertain) ──────────────────
    if cnn_cat:
        return cnn_cat, cnn_conf, cnn_top5

    # ── 5. Last resort ────────────────────────────────────────────────────
    h = (str(hint).strip() if hint else "") or "dog"
    return h, 0.0, [{"label": h, "conf": 0.0}]



# ---------------------------------------------------------------------------
# /api/animate  (single sketch)
# ---------------------------------------------------------------------------

@app.route("/api/animate", methods=["POST"])
def animate_sketch():
    data = request.get_json(silent=True) or {}
    if "image" not in data:
        return jsonify({"error": "No image provided"}), 400

    can_classify = model is not None and isinstance(classes, dict) and len(classes) > 0
    if not can_classify and not _allow_without_classifier():
        return jsonify({"error": "Classifier missing."}), 503

    image_data = data["image"]
    if 'base64,' in image_data:
        image_data = image_data.split('base64,')[1]
    img = Image.open(io.BytesIO(base64.b64decode(image_data)))

    filename_base = str(uuid.uuid4())
    raw_path = os.path.join(app.config['OUTPUT_FOLDER'], f"{filename_base}.png")
    strokes  = data.get("strokes", [])
    _render_strokes_to_png(strokes, img, raw_path)

    hint = (data or {}).get("category_hint") or (data or {}).get("category")
    predicted_category, confidence, top5 = _classify(raw_path, strokes, hint)

    gif_filename = f"{filename_base}.gif"
    gif_path = os.path.join(app.config['OUTPUT_FOLDER'], gif_filename)
    try:
        animate(raw_path, {"category": predicted_category}, gif_path)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'category':   predicted_category,
        'confidence': round(confidence, 1),
        'top5':       top5,
        'gif_url':    f'/output/{gif_filename}',
    })


# ---------------------------------------------------------------------------
# /api/animate-pair  (two sketches + interaction)
# ---------------------------------------------------------------------------

@app.route("/api/animate-pair", methods=["POST"])
def animate_pair():
    """
    Body JSON:
      image1, strokes1, [category_hint1]
      image2, strokes2, [category_hint2]
    Returns:
      category1/2, confidence1/2, top5_1/2, gif_url1/2, interaction_gif_url
    """
    data = request.get_json(silent=True) or {}
    if "image1" not in data or "image2" not in data:
        return jsonify({"error": "image1 and image2 are required"}), 400

    can_classify = model is not None and isinstance(classes, dict) and len(classes) > 0
    if not can_classify and not _allow_without_classifier():
        return jsonify({"error": "Classifier missing."}), 503

    results = []
    for idx in (1, 2):
        image_data = data[f"image{idx}"]
        if 'base64,' in image_data:
            image_data = image_data.split('base64,')[1]
        img = Image.open(io.BytesIO(base64.b64decode(image_data)))

        fb       = str(uuid.uuid4())
        raw_path = os.path.join(app.config['OUTPUT_FOLDER'], f"{fb}.png")
        strokes  = data.get(f"strokes{idx}", [])
        _render_strokes_to_png(strokes, img, raw_path)

        hint = data.get(f"category_hint{idx}") or data.get(f"category{idx}")
        cat, conf, top5 = _classify(raw_path, strokes, hint)

        gif_name = f"{fb}.gif"
        gif_path = os.path.join(app.config['OUTPUT_FOLDER'], gif_name)
        try:
            animate(raw_path, {"category": cat}, gif_path)
        except Exception as e:
            return jsonify({'error': f'sketch {idx}: {e}'}), 500

        results.append({
            "category":   cat,
            "confidence": round(conf, 1),
            "top5":       top5,
            "gif_url":    f'/output/{gif_name}',
            "gif_path":   gif_path,
        })

    # Generate interaction GIF
    iact_name = f"interaction_{uuid.uuid4()}.gif"
    iact_path = os.path.join(app.config['OUTPUT_FOLDER'], iact_name)
    try:
        generate_interaction_gif(
            results[0]["gif_path"], results[1]["gif_path"],
            results[0]["category"], results[1]["category"],
            iact_path,
        )
    except Exception as e:
        return jsonify({'error': f'interaction: {e}'}), 500

    return jsonify({
        "category1":           results[0]["category"],
        "confidence1":         results[0]["confidence"],
        "top5_1":              results[0]["top5"],
        "gif_url1":            results[0]["gif_url"],
        "category2":           results[1]["category"],
        "confidence2":         results[1]["confidence"],
        "top5_2":              results[1]["top5"],
        "gif_url2":            results[1]["gif_url"],
        "interaction_gif_url": f'/output/{iact_name}',
    })


# ---------------------------------------------------------------------------
# /api/sketch-sample/<label>  — return a real QuickDraw 28x28 bitmap
# ---------------------------------------------------------------------------

import random as _random
import numpy as _np

@app.route("/api/sketch-sample/<path:label>")
def sketch_sample(label):
    """
    Returns a real QuickDraw sample for <label> as a transparent-bg PNG.
    Ink = black, background = transparent (RGBA).
    Query param ?size=120 controls output px size (default 120).
    """
    npy_path = os.path.join("quickdraw_data", f"{label}.npy")
    if not os.path.exists(npy_path):
        return jsonify({"error": f"No data for '{label}'"}), 404

    size = int(request.args.get("size", 120))

    data   = _np.load(npy_path, mmap_mode="r")
    idx    = _random.randint(0, min(999, len(data) - 1))
    bitmap = data[idx].reshape(28, 28).astype(_np.uint8)  # 0=bg, 255=ink

    # Scale up with nearest-neighbour to keep the hand-drawn feel
    pil = Image.fromarray(bitmap, "L").resize((size, size), Image.NEAREST)
    arr = _np.array(pil)

    # RGBA: black strokes, alpha = ink intensity
    rgba        = _np.zeros((size, size, 4), dtype=_np.uint8)
    rgba[:,:,3] = arr           # alpha channel: 255 where ink
    # Leave RGB at 0 (black strokes on transparent background)

    out = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    out.save(buf, "PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    return jsonify({"image": f"data:image/png;base64,{b64}", "label": label})


if __name__ == "__main__":
    print("\n  SquiggleWiggle — open http://localhost:5001 in your browser\n")
    app.run(host="0.0.0.0", port=5001, debug=True)
