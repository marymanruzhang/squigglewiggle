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
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024   # 200 MB (for video uploads)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

# Downloads directory — each session gets its own subfolder
DOWNLOADS_DIR = os.path.join(os.path.dirname(__file__), 'static', 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

MODEL_PATH    = "sketch_model.keras"
CLASS_IDX_PATH = "class_indices.json"
_AUTO_FALLBACK = os.environ.get("HYPERSENSE_REQUIRE_MODEL", "").lower() not in (
    "1", "true", "yes",
)

model   = None
classes: dict | None = None

# Public URL exposed by ngrok (set at startup). None = local-only mode.
# Returned by /api/server-info so the frontend always builds correct QR URLs.
_PUBLIC_URL: str | None = None


def _allow_without_classifier() -> bool:
    return _AUTO_FALLBACK


# ── /api/server-info ──────────────────────────────────────────────────────────
# Returns the public base URL (ngrok or LAN) so the frontend can build QR codes
# that work on phones regardless of what URL the operator's browser is using.
@app.route('/api/server-info')
def server_info():
    return jsonify({'public_url': _PUBLIC_URL or ''})


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
                "content": (
                    "You are an expert sketch recognizer for a creative drawing animation engine.\n"
                    "CONTEXT: Users are given a whiteboard with a faint mountain/triangle silhouette template. "
                    "They draw ON TOP of that template to transform it into something completely new. "
                    "The mountain outline is just a starting prompt — the user's colored strokes define the actual object.\n"
                    "YOUR TASK: Look at the full image and identify what the user INVENTED — what did they transform "
                    "the shape into? Focus on the user's drawn lines, colors, and added details. "
                    "Ignore the background mountain template silhouette.\n\n"
                    "CATEGORIES (pick exactly one):\n"
                    "  land_animal     – any animal that walks on land (dog, cat, horse, camel, elephant, lion, bear, sheep, etc.)\n"
                    "  flying_animal   – any animal that flies (bird, butterfly, bat, eagle, owl, parrot, flamingo, etc.)\n"
                    "  aquatic_animal  – any animal that swims (fish, dolphin, whale, shark, octopus, crab, sea turtle, etc.)\n"
                    "  insect          – small crawling/buzzing creatures (ant, bee, spider, scorpion, snail, frog, etc.)\n"
                    "  mythical        – fantasy creatures (dragon, mermaid, angel, unicorn, phoenix, alien, flying saucer, etc.)\n"
                    "  human_character – humans, faces, body parts in a character sense (person, face, yoga, mermaid person, etc.)\n"
                    "  plant           – any plant life (flower, tree, cactus, bush, mushroom, grass, sunflower, palm tree, etc.)\n"
                    "  celestial       – space/sky objects (sun, moon, star, planet, comet, saturn, galaxy, etc.)\n"
                    "  weather         – weather phenomena (cloud, rain, lightning, tornado, rainbow, snowflake, hurricane, etc.)\n"
                    "  nature_element  – natural loose elements (leaf, feather, rock, crystal, bubble, balloon, etc.)\n"
                    "  food            – any food or drink (apple, pizza, hamburger, cake, donut, banana, ice cream, carrot, etc.)\n"
                    "  vehicle_land    – wheeled/land vehicles (car, bus, truck, bicycle, motorcycle, skateboard, tractor, etc.)\n"
                    "  vehicle_air     – flying vehicles (airplane, helicopter, hot air balloon, rocket, drone, etc.)\n"
                    "  vehicle_water   – water vehicles (sailboat, submarine, ship, canoe, speedboat, etc.)\n"
                    "  built_structure – buildings and large structures (house, castle, lighthouse, barn, windmill, church, etc.)\n"
                    "  tool_object     – tools and utensils (hammer, scissors, knife, screwdriver, shovel, axe, fork, etc.)\n"
                    "  instrument      – musical instruments (guitar, piano, drums, violin, trumpet, saxophone, etc.)\n"
                    "  sports_object   – sports equipment (basketball, soccer ball, boomerang, tennis racquet, golf club, etc.)\n"
                    "  clothing        – wearable items (t-shirt, hat, shoe, umbrella, sock, jacket, belt, etc.)\n"
                    "  geometric       – shapes and abstract forms (circle, triangle, square, star, spiral, diamond, etc.)\n"
                    "  electronic      – electronics and gadgets (phone, computer, TV, radio, camera, calculator, etc.)\n\n"
                    "Respond with ONLY valid JSON (no markdown, no extra text):\n"
                    "{\"category\": \"<one of the 21 IDs above>\", "
                    "\"label\": \"<specific common name of the invented object, e.g. 'flower', 'dog', 'rocket'>\", "
                    "\"description\": \"<one sentence describing what the user drew and its key features>\", "
                    "\"rotation_correction\": <integer: degrees to rotate the image clockwise so the sketch appears right-side-up; use 0 if already upright, 90 if top points left, -90 if top points right, 180 if upside-down>}\n"
                    "If ambiguous, pick the single best-fit category. NEVER output 'sketch', 'drawing', or 'doodle' as the label. "
                    "Always give a real object name."
                )
            },
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "What did the user invent/transform in this sketch? Reply with JSON only." },
                    { "type": "image_url", "image_url": { "url": f"data:image/png;base64,{base64_img}", "detail": "high" } }
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
            result  = json.loads(response.read().decode())
            message = result["choices"][0]["message"]
            content = message.get("content")  # may be None on refusal

            # GPT-4o may refuse with a "refusal" field and null content
            if not content:
                refusal = message.get("refusal") or "no description"
                print(f"[classify-sketch] GPT refused: {refusal}")
                # Fall through to Gemini fallback below
                raise ValueError(f"GPT refusal: {refusal}")

            # Strip markdown code fences if present
            cleaned = content.strip().replace("```json", "").replace("```", "").strip()

            # Robust JSON extraction
            json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if json_match:
                cleaned = json_match.group(0)

            parsed = json.loads(cleaned)
            # Ensure all required fields present
            parsed.setdefault("category", "object")
            parsed.setdefault("label",    parsed.get("category", "object"))
            parsed.setdefault("description", "A hand-drawn sketch.")
            # Clamp rotation_correction to one of the four canonical values
            raw_rot = parsed.get("rotation_correction", 0)
            try:
                raw_rot = int(round(float(raw_rot)))
            except (TypeError, ValueError):
                raw_rot = 0
            # Snap to nearest of 0, 90, -90, 180
            snap_map = {0: 0, 90: 90, 180: 180, -90: -90, 270: -90, -180: 180, -270: 90}
            parsed["rotation_correction"] = snap_map.get(raw_rot, 0)
            # Never let label be a generic fallback word — replace with category if needed
            if parsed["label"].lower() in {"sketch", "drawing", "doodle", "image", "picture", "unknown"}:
                parsed["label"] = parsed["category"]
            print(f"[classify-sketch] GPT-4o → label='{parsed['label']}' category='{parsed['category']}' rotation={parsed['rotation_correction']}°")
            return jsonify(parsed)

    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"[classify-sketch] HTTPError: {e.code} {e.reason} — {err_body}")
        # Fall through to Gemini fallback
    except json.JSONDecodeError as e:
        print(f"[classify-sketch] JSON parse error: {e}")
        # Fall through to Gemini fallback
    except Exception as e:
        print(f"[classify-sketch] GPT error: {e}")
        # Fall through to Gemini fallback

    # ── Gemini fallback ────────────────────────────────────────────────────────
    # Called whenever GPT fails, refuses, or returns unparseable JSON.
    try:
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if gemini_key and base64_img:
            gemini_system = (
                "You are a sketch recognizer. The image shows a whiteboard with a faint mountain/triangle template "
                "that the user drew ON TOP of to transform it into something new. "
                "Identify what the user invented. Reply ONLY with valid JSON: "
                '{"category": "<one of: land_animal, flying_animal, aquatic_animal, insect, mythical, human_character, '
                'plant, celestial, weather, nature_element, food, vehicle_land, vehicle_air, vehicle_water, '
                'built_structure, tool_object, instrument, sports_object, clothing, geometric, electronic>", '
                '"label": "<specific real object name, never write sketch/drawing/doodle>", '
                '"description": "<one sentence>"}. Best guess always, never refuse.'
            )
            gemini_payload = {
                "contents": [{
                    "parts": [
                        {"text": gemini_system},
                        {"inline_data": {"mime_type": "image/png", "data": base64_img}}
                    ]
                }],
                "generationConfig": {"maxOutputTokens": 200, "temperature": 0.3}
            }
            gem_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            gem_req = urllib.request.Request(
                gem_url,
                data=json.dumps(gemini_payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(gem_req) as gem_resp:
                gem_result  = json.loads(gem_resp.read().decode())
                gem_content = gem_result["candidates"][0]["content"]["parts"][0]["text"].strip()
                gem_cleaned = gem_content.replace("```json", "").replace("```", "").strip()
                gm = re.search(r'\{.*\}', gem_cleaned, re.DOTALL)
                if gm: gem_cleaned = gm.group(0)
                gem_parsed = json.loads(gem_cleaned)
                gem_parsed.setdefault("category", "object")
                gem_parsed.setdefault("label",    gem_parsed.get("category", "object"))
                gem_parsed.setdefault("description", "A hand-drawn sketch.")
                gem_parsed.setdefault("rotation_correction", 0)
                if gem_parsed["label"].lower() in {"sketch", "drawing", "doodle", "image", "picture", "unknown"}:
                    gem_parsed["label"] = gem_parsed["category"]
                print(f"[classify-sketch] Gemini fallback → label='{gem_parsed['label']}' category='{gem_parsed['category']}' rotation={gem_parsed.get('rotation_correction', 0)}°")
                return jsonify(gem_parsed)
    except Exception as gem_err:
        print(f"[classify-sketch] Gemini fallback failed: {gem_err}")

    # ── Last-resort graceful default ───────────────────────────────────────────
    # Use 'object' category (mobile, interactive) so the sketch still animates
    print("[classify-sketch] All classifiers failed — using last-resort fallback")
    return jsonify({"category": "object", "label": "object", "description": "An unrecognized hand-drawn sketch."}), 200



# ── /api/detect-orientation ────────────────────────────────────────────────────
@app.route("/api/detect-orientation", methods=["POST"])
def detect_orientation():
    """
    Dedicated orientation detector — separate from classification so GPT can
    focus exclusively on rotation without being distracted by labelling.

    Input JSON: { image: base64DataURL, label: "butterfly" }
    Returns:    { rotation_correction: 0|90|-90|180,
                  confidence: "high"|"medium"|"low",
                  reasoning: "..." }
    """
    data       = request.get_json(silent=True) or {}
    image_data = data.get("image", "")
    label      = data.get("label", "object").strip() or "object"

    if not image_data:
        return jsonify({"rotation_correction": 0, "confidence": "low", "reasoning": "No image provided"}), 200

    base64_img = image_data.split("base64,")[1] if "base64," in image_data else image_data

    openai_key = get_openai_key()
    if not openai_key:
        return jsonify({"rotation_correction": 0, "confidence": "low", "reasoning": "No API key"}), 200

    system_prompt = (
        f"You are analysing whether a hand-drawn sketch needs orientation correction.\n"
        f"The sketch depicts: **{label}**\n\n"
        f"CRITICAL RULE: Users almost always draw things correctly. "
        f"Return rotation_correction=0 in the VAST MAJORITY of cases. "
        f"Only flag a sketch if it is UNMISTAKABLY, OBVIOUSLY sideways — "
        f"e.g. a butterfly with wings pointing up/down instead of left/right, "
        f"or a fish drawn vertically. Even slight ambiguity means you must return 0.\n\n"
        f"NATURAL ORIENTATIONS (use to judge):\n"
        f"  butterfly  → wings LEFT and RIGHT — sideways only if wings point UP/DOWN\n"
        f"  flower     → stem at BOTTOM, petals at TOP — almost always drawn correctly, do NOT rotate\n"
        f"  fish       → body horizontal — sideways only if body is vertical\n"
        f"  tree/plant → trunk at BOTTOM, canopy at TOP — almost always correct\n"
        f"  person     → head at TOP, feet at BOTTOM\n"
        f"  sun/moon/star/cloud → any orientation fine → always return 0\n"
        f"  vehicle    → horizontal, wheels at BOTTOM\n\n"
        f"STRICT RULES:\n"
        f"  * Return 0 whenever you are not 100 percent certain the sketch is sideways.\n"
        f"  * 180 degrees is EXTREMELY rare — only if unmistakably inverted.\n"
        f"  * If the object could plausibly be drawn this way intentionally, return 0.\n"
        f"  * confidence='high' only for the most obvious 90-degree sideways cases.\n\n"
        f"Reply ONLY with this JSON (no markdown):\n"
        f'{{\"rotation_correction\": <0, 90, -90, or 180>, '
        f'\"confidence\": \"<high|medium|low>\", '
        f'\"facing_direction\": \"<left|right|neutral>\", '
        f'\"reasoning\": \"<one sentence>\"}}\n\n'
        f"Values: 0=upright (DEFAULT), 90=top points left, -90=top points right, 180=upside-down.\n"
        f"facing_direction: right=front/face points RIGHT in image, left=front/face points LEFT, "
        f"neutral=symmetrical (flower, star, sun, cloud, tree → always neutral).\n"
        f"DEFAULT IS 0. WHEN IN DOUBT RETURN 0."
    )

    payload = {
        "model": "gpt-4o",
        "max_tokens": 120,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": f"Is this {label} oriented correctly? Reply with JSON only."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_img}", "detail": "high"}},
            ]},
        ],
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {openai_key}"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as response:
            result  = json.loads(response.read().decode())
            content = result["choices"][0]["message"].get("content", "")
            cleaned = re.search(r"\{.*\}", content, re.DOTALL)
            if cleaned:
                parsed = json.loads(cleaned.group(0))
            else:
                raise ValueError("No JSON in GPT response")

            # Snap to canonical values
            raw_rot = int(round(float(parsed.get("rotation_correction", 0))))
            snap    = {0: 0, 90: 90, -90: -90, 180: 180, 270: -90, -180: 180, -270: 90}
            rot     = snap.get(raw_rot, 0)

            confidence = parsed.get("confidence", "medium")
            reasoning  = parsed.get("reasoning", "")

            raw_facing = parsed.get("facing_direction", "neutral").lower().strip()
            facing     = raw_facing if raw_facing in ("left", "right", "neutral") else "neutral"

            print(f"[detect-orientation] '{label}' → {rot}° ({confidence}) facing={facing} — {reasoning}")
            return jsonify({"rotation_correction": rot, "confidence": confidence,
                            "facing_direction": facing, "reasoning": reasoning})

    except Exception as e:
        print(f"[detect-orientation] GPT error for '{label}': {e}")
        return jsonify({"rotation_correction": 0, "confidence": "low", "reasoning": f"Detection failed: {e}"}), 200



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


# Python-side capability system (mirrors subjectCapabilities.js)
# Used to inject capability constraints into GPT prompts.
_STATIC_LABELS  = {'house','building','castle','tower','bridge','mountain','rock','cliff',
                    'tree','plant','flower','rose','tulip','daisy','sunflower','cactus','fern',
                    'mushroom','grass','bush','statue'}
_BLOSSOM_LABELS = {'flower','rose','tulip','daisy','sunflower','lotus','blossom','tree',
                    'bush','plant','fern','cactus'}
_GLOW_LABELS    = {'house','building','castle','tower','star','moon','sun','comet','planet',
                    'rainbow','lightning','fire','lantern','candle','gem','diamond','ring'}
_ANIMATE_LABELS = {'dog','cat','rabbit','sheep','cow','pig','horse','deer','fox','wolf','bear',
                    'lion','tiger','elephant','giraffe','turtle','frog','snake','worm','caterpillar',
                    'butterfly','bee','dragonfly','moth','ant','ladybug','bird','eagle','owl',
                    'penguin','flamingo','parrot','duck','fish','shark','whale','dolphin','octopus',
                    'crab','person','human','figure','robot'}
_STATIC_CATS    = {'plant','nature','building','landscape','vehicle','object'}
_ANIMATE_CATS   = {'animal','insect','bird','fish','sea creature','marine','character','people','person'}

def _get_cap_constraints(label, category):
    """Return a short constraint string for a subject, for injection into GPT prompts."""
    ll, cl = label.lower().strip(), category.lower().strip()
    is_static  = ll in _STATIC_LABELS  or cl in _STATIC_CATS
    is_animate = ll in _ANIMATE_LABELS or cl in _ANIMATE_CATS
    can_bloom  = ll in _BLOSSOM_LABELS
    can_glow   = ll in _GLOW_LABELS
    parts = []
    if is_static:  parts.append('is_static (cannot move, flee, or chase)')
    if is_animate: parts.append('is_animate (can move, flee, approach)')
    if can_bloom:  parts.append('can_blossom')
    if can_glow:   parts.append('can_glow')
    if not parts:  parts.append('passive object')
    return ', '.join(parts)


# ── /api/semantic-scene ───────────────────────────────────────────────────────
# Given two sketch labels + categories, asks GPT-4o to describe how they should
# interact semantically. Returns motion hints, narrative, and approach behavior.
@app.route("/api/semantic-scene", methods=["POST"])
def semantic_scene():
    data           = request.get_json(silent=True) or {}
    label_left     = data.get("label_left",     "unknown")
    label_right    = data.get("label_right",    "unknown")
    category_left  = data.get("category_left",  "")
    category_right = data.get("category_right", "")
    tags_left      = data.get("tags_left",      [])
    tags_right     = data.get("tags_right",     [])

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"error": "No API key"}), 500

    cap_left  = _get_cap_constraints(label_left,  category_left)
    cap_right = _get_cap_constraints(label_right, category_right)

    prompt = f"""Two hand-drawn sketches will animate together on screen.
Sketch A (left):  "{label_left}"  category="{category_left}"  capabilities: {cap_left}
Sketch B (right): "{label_right}" category="{category_right}" capabilities: {cap_right}

Describe a brief, charming interaction between them. Return ONLY valid JSON:
{{
  "narrative": "one sentence describing what happens",
  "left_behavior": "approach|stay|flee|orbit|circle_around|wander",
  "right_behavior": "approach|stay|flee|orbit|circle_around|wander",
  "left_motion_hint": "one of: walk, fly, swim, bounce, sway, idle, spin",
  "right_motion_hint": "one of: walk, fly, swim, bounce, sway, idle, spin",
  "interaction_type": "one of: greet, chase, avoid, shelter, admire, play, coexist"
}}

Capability rules (MUST obey):
- Any subject with is_static MUST have behavior "stay" — it cannot move, flee, or chase
- Only subjects with can_blossom may "bloom", "blossom", "flower", or "open" in the narrative
- Only subjects with can_glow may "glow", "light up", or "shine" in the narrative
- Animate subjects (is_animate) can approach, flee, orbit, and interact freely
- Do NOT write that a building bounced, blossomed, ran, fled, or chased
- Do NOT write that a plant ran, fled, or chased
- The narrative must only describe actions the subject is physically capable of

Examples:
  fairy + house     → fairy approaches, house stays; fairy peeks through the window and the house glows warmly
  dog + cat         → dog approaches, cat flees; a playful chase through the scene
  butterfly + flower→ butterfly orbits, flower sways; butterfly pollinates the flower which opens in bloom
  sheep + mountain  → sheep approaches, mountain stays; sheep grazes peacefully at the mountain's base
  fish + octopus    → both approach and swim; two sea creatures meet and dance"""

    payload = {
        "model": "gpt-4o",
        "max_tokens": 300,
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
            print(f"[semantic-scene] {label_left} ↔ {label_right}: {parsed.get('narrative','')}")
            return jsonify(parsed)
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
- The SMALLER gets a fraction between 0.15 and 1.0
- IMPORTANT: mountains, buildings, trees, and landscapes are ENORMOUS compared to animals or flowers
- Minimum scale is 0.15 so nothing disappears
- If sizes are similar, both values should be close to 1.0

Critical examples (memorize these):
  mountain vs flower → mountain=1.0, flower=0.08  (mountain is thousands of times bigger)
  mountain vs sheep  → mountain=1.0, sheep=0.12
  mountain vs dog    → mountain=1.0, dog=0.10
  tree vs flower     → tree=1.0,    flower=0.30
  tree vs dog        → tree=1.0,    dog=0.60
  elephant vs dog    → elephant=1.0, dog=0.45
  person vs elephant → person=0.45,  elephant=1.0
  butterfly vs flower→ flower=1.0,   butterfly=0.40
  cat vs dog         → dog=1.0,      cat=0.85
  sun vs cloud       → sun=1.0,      cloud=0.55"""

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
            ls = max(0.15, min(1.0, float(parsed.get("left_scale",  1.0))))
            rs = max(0.15, min(1.0, float(parsed.get("right_scale", 1.0))))
            reasoning = parsed.get("reasoning", "")
            print(f"[compare-sizes] {label_left}={ls:.2f} vs {label_right}={rs:.2f} — {reasoning}")
            return jsonify({"left_scale": ls, "right_scale": rs, "reasoning": reasoning})
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"HTTP {e.code}: {e.read().decode()}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── /api/live-story ───────────────────────────────────────────────────────────
# Phase 2: Semantic interaction engine.
# Returns both GPT narrative metadata AND a beat specification so the frontend
# can drive interactions using the existing storyRunner beat system.
@app.route("/api/live-story", methods=["POST"])
def live_story():
    data       = request.get_json(silent=True) or {}
    label_a    = data.get("label_a",    "unknown")
    category_a = data.get("category_a", "")
    tags_a     = data.get("tags_a",     [])
    label_b    = data.get("label_b",    "unknown")
    category_b = data.get("category_b", "")
    tags_b     = data.get("tags_b",     [])

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"error": "No API key"}), 500

    cap_a = _get_cap_constraints(label_a, category_a)
    cap_b = _get_cap_constraints(label_b, category_b)

    prompt = f"""Two hand-drawn sketches will animate together on a shared canvas.
Sketch A: "{label_a}"  category="{category_a}"  capabilities: {cap_a}
Sketch B: "{label_b}"  category="{category_b}"  capabilities: {cap_b}

Describe a brief, charming, semantically meaningful interaction between them.
Return ONLY valid JSON (no extra text, no markdown):
{{
  "narrative": "one vivid sentence describing what happens",
  "interaction_type": "one of: greet|chase|avoid|shelter|admire|play|coexist",
  "behavior_a": "one of: approach|stay|flee|orbit|wander",
  "behavior_b": "one of: approach|stay|flee|orbit|wander",
  "motion_hint_a": "one of: walk|fly|swim|bounce|sway|idle",
  "motion_hint_b": "one of: walk|fly|swim|bounce|sway|idle",
  "tags_inferred": ["optional", "extra", "semantic", "tags"]
}}

Capability rules (MUST obey):
- Any subject with is_static MUST have behavior "stay" — it cannot move, flee, or chase
- Only subjects with can_blossom may "bloom", "blossom", or "open" in the narrative
- Only subjects with can_glow may "glow", "light up", or "shine" in the narrative
- Animate subjects (is_animate) can approach, flee, orbit, and interact freely
- Do NOT say a building bounced, blossomed, ran, fled, or chased
- Do NOT say a plant ran, fled, or chased
- The narrative must describe only actions the subject can physically do

Examples:
  bee + flower     → behavior_a=orbit, behavior_b=stay, interaction_type=admire, flower sways and blooms
  dog + cat        → behavior_a=approach, behavior_b=flee, interaction_type=chase
  sheep + mountain → behavior_a=approach, behavior_b=stay, interaction_type=coexist, sheep grazes at the base
  butterfly + house→ behavior_a=orbit, behavior_b=stay, interaction_type=admire, house glows as the butterfly circles
  fish + shark     → behavior_a=flee, behavior_b=chase, interaction_type=chase"""

    payload = {
        "model": "gpt-4o",
        "max_tokens": 350,
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
            print(f"[live-story] {label_a} <-> {label_b}: {parsed.get('narrative','')}")
            return jsonify(parsed)
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"HTTP {e.code}: {e.read().decode()}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── /api/sketch-color ─────────────────────────────────────────────────────────
# Returns the ideal fill color for a hand-drawn sketch of <label>.
# Uses GPT-4o-mini for fast, cheap inference. Server-side cache prevents
# redundant calls — each label is looked up at most once per server session.
_color_cache: dict = {}

@app.route("/api/sketch-color", methods=["POST"])
def sketch_color():
    data  = request.get_json(silent=True) or {}
    label = (data.get("label") or "object").strip().lower()

    # Serve from cache
    if label in _color_cache:
        return jsonify(_color_cache[label])

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        return jsonify({"r": 220, "g": 210, "b": 195, "a": 150})

    prompt = (
        f'A child has drawn a sketch of a "{label}" on paper.\n'
        f'What bright, saturated fill color should the interior of this sketch have?\n'
        f'Return ONLY valid JSON with keys r, g, b (integers 0-255) and a (integer 140-200).\n'
        f'Choose a color that feels vivid and natural for the object.\n'
        f'Examples:\n'
        f'  "pumpkin"       -> {{"r":235,"g":120,"b":40,"a":180}}\n'
        f'  "ocean"         -> {{"r":60,"g":140,"b":220,"a":170}}\n'
        f'  "flamingo"      -> {{"r":255,"g":150,"b":190,"a":175}}\n'
        f'  "jack-o-lantern"-> {{"r":240,"g":110,"b":30,"a":180}}\n'
        f'  "handbag"       -> {{"r":180,"g":120,"b":90,"a":170}}\n'
        f'  "banana"        -> {{"r":255,"g":230,"b":60,"a":180}}'
    )

    payload = {
        "model": "gpt-4o-mini",
        "max_tokens": 60,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {openai_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            raw     = json.loads(resp.read().decode())
            content = raw["choices"][0]["message"]["content"].strip()
            color   = json.loads(content)
            # Clamp values to safe ranges
            result = {
                "r": max(0, min(255, int(color.get("r", 220)))),
                "g": max(0, min(255, int(color.get("g", 210)))),
                "b": max(0, min(255, int(color.get("b", 195)))),
                "a": max(120, min(220, int(color.get("a", 165)))),
            }
            _color_cache[label] = result
            print(f"[sketch-color] \"{label}\" → rgb({result['r']},{result['g']},{result['b']},{result['a']})")
            return jsonify(result)
    except Exception as e:
        print(f"[sketch-color] fallback for \"{label}\": {e}")
        fallback = {"r": 220, "g": 210, "b": 195, "a": 150}
        _color_cache[label] = fallback
        return jsonify(fallback)


# ── /api/animated-drawings ────────────────────────────────────────────────────
# Phase 3: Meta AnimatedDrawings integration for 4-limbed characters.
# Takes { image: base64, label: str, joints: dict, motion: str }
# Returns { frames: [base64_png, ...], isSkeletal: bool }
# Falls back to existing PIL skeletal walk if AnimatedDrawings is unavailable.

_AD_CAPABLE_LABELS = {
    "human", "person", "man", "woman", "stick figure", "boy", "girl",
    "dog", "cat", "horse", "cow", "sheep", "rabbit", "elephant", "bear",
    "lion", "tiger", "giraffe", "fox", "deer", "pig", "frog", "lizard",
    "turtle", "tortoise", "kangaroo", "wolf", "mouse",
}

@app.route("/api/animated-drawings", methods=["POST"])
def animated_drawings_endpoint():
    data       = request.get_json(silent=True) or {}
    image_data = data.get("image", "")
    label      = data.get("label",  "dog").lower()
    joints     = data.get("joints", {})
    motion     = data.get("motion", "walk")

    if not image_data:
        return jsonify({"error": "No image provided"}), 400

    if label not in _AD_CAPABLE_LABELS:
        return jsonify({"isSkeletal": False, "frames": []}), 200

    if 'base64,' in image_data:
        image_data = image_data.split('base64,')[1]

    img = Image.open(io.BytesIO(base64.b64decode(image_data))).convert("RGBA")

    # Try Meta AnimatedDrawings pipeline first
    try:
        from animation_engine.animated_drawings_bridge import generate_ad_frames
        frames = generate_ad_frames(img, label, joints, motion)
        b64_frames = []
        for f in frames:
            buf = io.BytesIO()
            f.save(buf, format="PNG")
            b64_frames.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
        return jsonify({"isSkeletal": True, "frames": b64_frames})
    except Exception as e:
        print(f"[animated-drawings] AD fallback: {e}")

    # Fallback: existing skeletal walk
    try:
        from animation_engine.skeletal import generate_skeletal_frames
        frames = generate_skeletal_frames(img.convert("RGB"))
        b64_frames = []
        for f in frames:
            buf = io.BytesIO()
            f.save(buf, format="PNG")
            b64_frames.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
        return jsonify({"isSkeletal": True, "frames": b64_frames})
    except Exception as e2:
        print(f"[animated-drawings] skeletal fallback failed: {e2}")
        return jsonify({"isSkeletal": False, "frames": []}), 200


# ── /api/save-assets ───────────────────────────────────────────────────────────
@app.route('/api/save-assets', methods=['POST'])
def save_assets():
    """
    Receives multipart/form-data with optional fields:
      screenshot  – PNG file (the Konva stage snapshot)
      video       – WebM / MP4 file (the recorded animation)
    Returns { session_id, png_url, video_url, download_page }
    """
    session_id  = uuid.uuid4().hex[:8]
    session_dir = os.path.join(DOWNLOADS_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    png_url   = None
    video_url = None

    screenshot = request.files.get('screenshot')
    if screenshot:
        screenshot.save(os.path.join(session_dir, 'sketch.png'))
        png_url = f'/static/downloads/{session_id}/sketch.png'
        print(f'[save-assets] PNG saved → {png_url}')

    video = request.files.get('video')
    if video:
        mime = video.content_type or ''
        ext  = 'mp4' if 'mp4' in mime else 'webm'
        video.save(os.path.join(session_dir, f'animation.{ext}'))
        video_url = f'/static/downloads/{session_id}/animation.{ext}'
        print(f'[save-assets] video saved → {video_url}')

    return jsonify({
        'session_id':    session_id,
        'png_url':       png_url,
        'video_url':     video_url,
        'download_page': f'/download/{session_id}',
    })


# ── /download/<session_id> ─────────────────────────────────────────────────────
@app.route('/download/<session_id>')
def download_page(session_id):
    """Mobile-friendly download page served when users scan the QR code."""
    session_dir = os.path.join(DOWNLOADS_DIR, session_id)
    if not os.path.isdir(session_dir):
        return '<h2>Session not found.</h2>', 404

    png_path   = os.path.join(session_dir, 'sketch.png')
    webm_path  = os.path.join(session_dir, 'animation.webm')
    mp4_path   = os.path.join(session_dir, 'animation.mp4')

    png_url   = f'/static/downloads/{session_id}/sketch.png'   if os.path.exists(png_path)  else None
    video_url = (f'/static/downloads/{session_id}/animation.mp4'  if os.path.exists(mp4_path)
                 else f'/static/downloads/{session_id}/animation.webm' if os.path.exists(webm_path)
                 else None)
    video_ext = 'mp4' if (video_url and 'mp4' in video_url) else 'webm'

    png_btn = f'''
      <a class="dl-btn" href="{png_url}" download="squiggle_sketch.png">
        🖼 Download Sketch (PNG)
      </a>''' if png_url else ''

    vid_btn = f'''
      <a class="dl-btn" href="{video_url}" download="squiggle_animation.{video_ext}">
        🎬 Download Animation ({video_ext.upper()})
      </a>''' if video_url else ''

    preview = f'<img src="{png_url}" alt="Your sketch" style="max-width:100%;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.1);margin-bottom:12px;">' if png_url else ''

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your SquiggleWiggle</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: Georgia, serif;
      background: linear-gradient(135deg, #f8f5f0, #e8f4f0);
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }}
    .card {{
      background: #fff;
      border-radius: 24px;
      padding: 36px 32px;
      max-width: 480px;
      width: 92%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,.12);
    }}
    h1 {{ color: #1b4332; font-size: 26px; margin-bottom: 6px; }}
    .sub {{ color: #555; font-size: 14px; margin-bottom: 24px; font-family: system-ui, sans-serif; }}
    .preview {{ margin-bottom: 20px; }}
    .dl-btn {{
      display: block;
      background: #2d6a4f;
      color: #fff;
      text-decoration: none;
      padding: 14px 20px;
      border-radius: 28px;
      font-size: 16px;
      margin: 10px auto;
      box-shadow: 0 4px 14px rgba(45,106,79,.3);
      transition: transform .15s;
    }}
    .dl-btn:hover {{ transform: scale(1.03); }}
  </style>
</head>
<body>
  <div class="card">
    <h1>Your Squiggle Wiggle ✨</h1>
    <p class="sub">Thanks for creating! Tap below to save your sketch and animation.</p>
    <div class="preview">{preview}</div>
    {png_btn}
    {vid_btn}
  </div>
</body>
</html>'''




if __name__ == "__main__":
    import socket as _socket
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv()

    _ngrok_token = os.environ.get("NGROK_AUTHTOKEN", "").strip()
    _public_url  = None

    if _ngrok_token:
        try:
            from pyngrok import ngrok as _ngrok, conf as _ngrok_conf
            _ngrok_conf.get_default().auth_token = _ngrok_token
            _tunnel      = _ngrok.connect(5001, "http")
            _public_url  = _tunnel.public_url.replace("http://", "https://")
            # Update the module-level global so /api/server-info can return it
            _PUBLIC_URL  = _public_url
        except Exception as _e:
            print(f"\n  ⚠  ngrok failed to start: {_e}")
            print("     Falling back to local-network mode.\n")

    # ── Detect LAN IP as fallback ─────────────────────────────────────────────
    try:
        _s = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
        _s.connect(("8.8.8.8", 80))
        _lan_ip = _s.getsockname()[0]
        _s.close()
    except Exception:
        _lan_ip = "127.0.0.1"

    print("\n" + "=" * 62)
    print("  SquiggleWiggle is starting…")
    print("=" * 62)
    if _public_url:
        print(f"\n  ✅  ngrok tunnel active!")
        print(f"\n  ┌─────────────────────────────────────────────┐")
        print(f"  │  Open in browser → {_public_url:<24} │")
        print(f"  └─────────────────────────────────────────────┘")
        print(f"\n  QR codes will encode this public URL so phones")
        print(f"  can download animations from ANYWHERE — no")
        print(f"  shared Wi-Fi required.")
    else:
        print(f"\n  ⚠  ngrok not active — local network only")
        print(f"\n  Operator browser  →  http://localhost:5001")
        print(f"  Phone / tablet    →  http://{_lan_ip}:5001")
        print(f"\n  Open the NETWORK URL in your browser so the QR")
        print(f"  code encodes the right address for phones.")
    print("\n" + "=" * 62 + "\n")

    # use_reloader=False prevents Flask's hot-reloader from spawning a second
    # process and creating a duplicate ngrok tunnel.
    app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)
