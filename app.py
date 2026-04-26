from __future__ import annotations

import os
import io

# Load .env so OPENAI_API_KEY is available (python-dotenv or manual fallback)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv not installed — read .env manually
    _env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith('#') and '=' in _line:
                    _k, _, _v = _line.partition('=')
                    os.environ.setdefault(_k.strip(), _v.strip())

import json
import base64
import uuid
import re
import traceback

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


# ---------------------------------------------------------------------------
# /api/skeletal-frames — generate 2D mesh-warped walk frames
# ---------------------------------------------------------------------------

@app.route("/api/skeletal-frames", methods=["POST"])
def skeletal_frames():
    """
    Takes { image: base64, category: str }
    Returns { frames: [base64, ...], isSkeletal: bool }
    """
    data = request.get_json(silent=True) or {}
    image_data = data.get("image")
    category   = data.get("category", "dog")

    from animation_engine.limb_bearing import should_use_limb_mesh
    if not should_use_limb_mesh(category):
        return jsonify({"isSkeletal": False, "frames": []})

    if not image_data:
        return jsonify({"error": "No image provided"}), 400

    if 'base64,' in image_data:
        image_data = image_data.split('base64,')[1]

    img = Image.open(io.BytesIO(base64.b64decode(image_data))).convert("RGB")

    from animation_engine.skeletal import generate_skeletal_frames
    try:
        frames = generate_skeletal_frames(img)
        # Convert frames to base64
        b64_frames = []
        for f in frames:
            buf = io.BytesIO()
            f.save(buf, format="PNG")
            b64_frames.append(f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}")

        return jsonify({
            "isSkeletal": True,
            "frames": b64_frames
        })
    except Exception as e:
        print(f"Error in skeletal_frames: {e}")
        return jsonify({"error": str(e)}), 500

import urllib.request

def get_openai_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key: return key
    try:
        with open(".env", "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None

@app.route("/api/classify-sketch", methods=["POST"])
def classify_sketch():
    """
    Takes { image: base64, svgPaths: [...] }
    Returns { category: "...", label: "...", description: "..." }
    Uses OpenAI GPT-4o for classification.
    """
    data = request.get_json(silent=True) or {}
    image_data = data.get("image")
    
    if not image_data:
        return jsonify({"error": "No image provided"}), 400

    if 'base64,' in image_data:
        base64_img = image_data.split('base64,')[1]
    else:
        base64_img = image_data

    openai_key = get_openai_key()
    if not openai_key:
        return jsonify({"error": "OpenAI key not configured on server"}), 500

    payload = {
        "model": "gpt-4o",
        "max_tokens": 200,
        "messages": [
            {
                "role": "system",
                "content": "You are an expert doodle recognizer. The image shows a whiteboard zone with:\n1. A hand-drawn cloud shape (the original visual prompt)\n2. Additional strokes drawn BY THE USER on top of or around the cloud\n\nYour task: identify what the COMPLETE drawing represents — what has the user transformed the cloud into?\nRespond with ONLY valid JSON in this exact format:\n{\"category\": \"<broad category e.g. animal, plant, vehicle, food, building, object>\", \"label\": \"<specific name e.g. daisy, school bus, hot air balloon>\", \"description\": \"<one sentence describing the complete drawing's key visual features, useful for animation>\"}\nIf the canvas shows only the cloud with no user additions, return: {\"category\": \"cloud\", \"label\": \"cloud\", \"description\": \"An unmodified cloud shape.\"}"
            },
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "What doodle is drawn on this whiteboard section?" },
                    { "type": "image_url", "image_url": { "url": f"data:image/png;base64,{base64_img}", "detail": "low" } }
                ]
            }
        ]
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {openai_key}"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
            content = result["choices"][0]["message"]["content"].strip()
            # Strip markdown code fences if present
            cleaned = content.replace("```json", "").replace("```", "").strip()
            
            # Robust JSON extraction
            import re
            json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if json_match:
                cleaned = json_match.group(0)
            
            return jsonify(json.loads(cleaned))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"HTTPError calling OpenAI: {e.code} {e.reason} - {err_body}")
        return jsonify({"error": f"HTTP {e.code}: {err_body}"}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error calling OpenAI: {e}")
        return jsonify({"error": str(e)}), 500


# ── /api/detect-parts ──────────────────────────────────────────────────────────
@app.route("/api/detect-parts", methods=["POST"])
def detect_parts():
    data = request.get_json(silent=True) or {}
    image_data = data.get("image", "")
    label = data.get("label", "unknown")

    if not image_data:
        return jsonify({"error": "No image provided"}), 400

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"error": "No API key configured"}), 500

    PART_GUIDELINES = {
        "butterfly": "body(float_vertical), wing_left(flap,freq:3.5,minScale:0.05), wing_right(flap,freq:3.5,minScale:0.05)",
        "moth":      "body(float_vertical), wing_left(flap,freq:2.5), wing_right(flap,freq:2.5)",
        "bird":      "body(float_vertical), wing_left(flap,freq:2), wing_right(flap,freq:2), tail(sway)",
        "bee":       "body(float_vertical), wing_left(flap,freq:5), wing_right(flap,freq:5)",
        "turtle":    "body(wiggle,amplitude:4), head(sway,amplitude:10), leg_front_left(walk_leg,phaseOffset:0), leg_front_right(walk_leg,phaseOffset:3.14), leg_back_left(walk_leg,phaseOffset:3.14), leg_back_right(walk_leg,phaseOffset:0)",
        "tortoise":  "body(wiggle,amplitude:3), head(sway), leg_front_left(walk_leg,phaseOffset:0), leg_front_right(walk_leg,phaseOffset:3.14), leg_back_left(walk_leg,phaseOffset:3.14), leg_back_right(walk_leg,phaseOffset:0)",
        "dog":       "body(float_vertical,amplitude:4), head(sway), tail(sway,amplitude:30,freq:2.5), leg_front_left(walk_leg,phaseOffset:0), leg_front_right(walk_leg,phaseOffset:3.14), leg_back_left(walk_leg,phaseOffset:3.14), leg_back_right(walk_leg,phaseOffset:0)",
        "cat":       "body(float_vertical,amplitude:3), head(sway), tail(sway,amplitude:35,freq:1.5), leg_front_left(walk_leg,phaseOffset:0), leg_front_right(walk_leg,phaseOffset:3.14), leg_back_left(walk_leg,phaseOffset:3.14), leg_back_right(walk_leg,phaseOffset:0)",
        "rabbit":    "body(float_vertical,amplitude:5), head(sway), ear_left(sway,amplitude:10), ear_right(sway,amplitude:10), leg_left(walk_leg), leg_right(walk_leg,phaseOffset:3.14)",
        "fish":      "body(sway,amplitude:10,freq:1.2), tail(sway,amplitude:20,freq:2.4)",
        "whale":     "body(sway,amplitude:8), tail(sway,amplitude:18,freq:1.5)",
        "flower":    "petals(pulse,scaleAmplitude:0.06), stem(sway,amplitude:8), center(rotate,freq:0.15)",
        "tree":      "canopy(sway,amplitude:7), trunk(static)",
        "jellyfish": "body(pulse,scaleAmplitude:0.1), tentacles(wiggle,amplitude:20)",
        "human":     "body(float_vertical,amplitude:3), head(sway,amplitude:6), arm_left(sway,amplitude:22,phaseOffset:0), arm_right(sway,amplitude:22,phaseOffset:3.14), leg_left(walk_leg,phaseOffset:0), leg_right(walk_leg,phaseOffset:3.14)",
    }

    guideline = PART_GUIDELINES.get(label.lower(), "body(wiggle,amplitude:12,freq:1.5)")

    prompt = f"""Analyze this hand-drawn sketch of a {label}. Identify animatable body parts and return their pixel bounding boxes.

Return ONLY valid JSON (no extra text):
{{
  "parts": [
    {{
      "id": "wing_left",
      "bbox": {{"x": 10, "y": 30, "w": 80, "h": 60}},
      "pivot": {{"x": 90, "y": 60}},
      "animation": "flap",
      "params": {{"freq": 3.5, "minScale": 0.05}}
    }}
  ]
}}

Animation types:
- flap: wing folds via scaleX oscillation (1→minScale→1). pivot = where wing meets body.
- sway: rotation ±amplitude degrees around pivot
- walk_leg: leg swings forward/back; use phaseOffset:0 or 3.14 for left/right alternation
- float_vertical: gentle up/down bob (amplitude in pixels)
- pulse: scale breathe (scaleAmplitude fraction, e.g. 0.06)
- rotate: continuous spin (freq = rotations/sec)
- wiggle: quick rotation twitch
- static: no movement

Expected parts for {label}: {guideline}

All coordinates are in pixels relative to the image. Keep bbox tight around each part."""

    payload = {
        "model": "gpt-4o",
        "max_tokens": 900,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_data, "detail": "high"}}
        ]}]
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {openai_key}"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
            content = result["choices"][0]["message"]["content"].strip()
            cleaned = content.replace("```json", "").replace("```", "").strip()
            json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if json_match:
                cleaned = json_match.group(0)
            return jsonify(json.loads(cleaned))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        return jsonify({"error": f"HTTP {e.code}: {err_body}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── /api/detect-joints ─────────────────────────────────────────────────────────
# Returns normalized [0-1] joint positions for LBS skeletal animation.
# Coordinates are fractions of image width/height so GPT-4o doesn't need to
# know exact pixel dimensions — the browser converts to pixels.
@app.route("/api/detect-joints", methods=["POST"])
def detect_joints():
    data = request.get_json(silent=True) or {}
    image_data = data.get("image", "")
    label      = data.get("label", "unknown")
    category   = data.get("category", "")

    if not image_data:
        return jsonify({"error": "No image provided"}), 400
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"error": "No API key"}), 500

    # Joint sets per character type
    JOINT_SETS = {
        "quadruped": "root, spine, neck, head, hip_L, knee_L, ankle_L, hip_R, knee_R, ankle_R",
        "biped":     "root, spine, neck, head, shoulder_L, elbow_L, shoulder_R, elbow_R, hip_L, knee_L, ankle_L, hip_R, knee_R, ankle_R",
        "bird":      "root, spine, neck, head, shoulder_L, elbow_L, shoulder_R, elbow_R, hip_L, ankle_L, hip_R, ankle_R",
        "fish":      "root, spine, tail_base, tail_tip",
        "insect":    "root, thorax, head, wing_L, wing_tip_L, wing_R, wing_tip_R, leg_L1, leg_L2, leg_R1, leg_R2",
    }

    lbl = label.lower()
    cat = category.lower()

    if any(x in lbl for x in ["butterfly","bee","moth","dragonfly","ant","ladybug"]):
        jtype, jset = "insect",    JOINT_SETS["insect"]
    elif any(x in lbl for x in ["fish","shark","whale","dolphin","eel"]):
        jtype, jset = "fish",      JOINT_SETS["fish"]
    elif any(x in lbl for x in ["bird","parrot","owl","penguin","duck","chicken"]):
        jtype, jset = "bird",      JOINT_SETS["bird"]
    elif any(x in lbl for x in ["human","person","girl","boy","man","woman"]):
        jtype, jset = "biped",     JOINT_SETS["biped"]
    elif cat == "ground_animal" or any(x in lbl for x in
        ["dog","cat","horse","cow","sheep","rabbit","fox","deer","bear","lion",
         "tiger","wolf","pig","turtle","tortoise","frog","lizard","elephant"]):
        jtype, jset = "quadruped", JOINT_SETS["quadruped"]
    else:
        return jsonify({"error": "not a limbed creature"}), 400

    prompt = f"""Analyze this hand-drawn sketch of a {label} and identify skeleton joint positions.

Return ONLY valid JSON (no extra text):
{{
  "type": "{jtype}",
  "joints": {{
    "root": [0.50, 0.70],
    "spine": [0.50, 0.45]
  }}
}}

Required joints: {jset}

Rules:
- Coordinates are NORMALIZED: x = column/imageWidth, y = row/imageHeight  (both 0.0 to 1.0)
- [0,0] = top-left corner, [1,1] = bottom-right corner
- root = center of mass / pelvis / body center
- For quadrupeds: root is belly center; hip_L/R are where front/back legs meet body;
  knee_L/R are leg midpoints; ankle_L/R are feet
- Place joints WHERE YOU SEE them on the actual drawing
- If a joint is not visible or the creature lacks that limb, place it near the body center
- Return ALL joints listed in: {jset}"""

    payload = {
        "model": "gpt-4o",
        "max_tokens": 600,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_data, "detail": "high"}}
        ]}]
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {openai_key}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as response:
            result  = json.loads(response.read().decode())
            content = result["choices"][0]["message"]["content"].strip()
            cleaned = content.replace("```json","").replace("```","").strip()
            m = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if m: cleaned = m.group(0)
            return jsonify(json.loads(cleaned))
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"HTTP {e.code}: {e.read().decode()}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── /api/compare-sizes ────────────────────────────────────────────────────────
# Given two sketch labels, asks GPT-4o for real-world relative sizes.
# Returns { left_scale, right_scale } both in [0.05, 1.0] where the
# larger real-world object gets 1.0 and the smaller gets a fraction.
@app.route("/api/compare-sizes", methods=["POST"])
def compare_sizes():
    data        = request.get_json(silent=True) or {}
    label_left  = data.get("label_left",  "unknown")
    label_right = data.get("label_right", "unknown")

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"error": "No API key"}), 500

    prompt = f"""Two people each drew a sketch. Person A drew a "{label_left}" and Person B drew a "{label_right}".

In real life, how large is each object compared to the other?

Return ONLY valid JSON (no extra text):
{{
  "left_scale": 0.8,
  "right_scale": 1.0,
  "reasoning": "brief explanation"
}}

Rules:
- The LARGER real-world object gets scale 1.0
- The SMALLER gets a fraction between 0.05 and 1.0  
- Use real-world intuition (a mountain is enormous vs a sheep; a butterfly is tiny vs a dog)
- Minimum scale is 0.05 so nothing disappears completely
- If sizes are similar in real life, both values should be close to 1.0

Examples of correct reasoning:
  dog vs mountain    → dog=0.10, mountain=1.0
  butterfly vs flower→ butterfly=0.40, flower=1.0
  person vs elephant → person=0.45, elephant=1.0
  cat vs dog         → cat=0.85,  dog=1.0
  tree vs house      → tree=0.90, house=1.0
  sun vs cloud       → sun=1.0,   cloud=0.55
  sheep vs mountain  → sheep=0.12, mountain=1.0"""

    payload = {
        "model": "gpt-4o",
        "max_tokens": 200,
        "messages": [{"role": "user", "content": prompt}]
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {openai_key}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as response:
            result  = json.loads(response.read().decode())
            content = result["choices"][0]["message"]["content"].strip()
            cleaned = content.replace("```json", "").replace("```", "").strip()
            m = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if m: cleaned = m.group(0)
            parsed = json.loads(cleaned)
            ls = max(0.05, min(1.0, float(parsed.get("left_scale",  1.0))))
            rs = max(0.05, min(1.0, float(parsed.get("right_scale", 1.0))))
            reasoning = parsed.get("reasoning", "")
            print(f"[compare-sizes] {label_left}={ls:.2f} vs {label_right}={rs:.2f} — {reasoning}")
            return jsonify({"left_scale": ls, "right_scale": rs, "reasoning": reasoning})
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"HTTP {e.code}: {e.read().decode()}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("\n  SquiggleWiggle — open http://localhost:5001 in your browser\n")
    app.run(host="0.0.0.0", port=5001, debug=True)
