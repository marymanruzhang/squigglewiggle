"""
Gemini Vision sketch classifier via direct REST API.
No google-generativeai SDK needed — avoids the protobuf conflict with TensorFlow.

Reads GOOGLE_API_KEY from the environment. Returns None if unavailable.
"""

from __future__ import annotations

import os
import base64
import json
import urllib.request
import urllib.error
from pathlib import Path

_QUICKDRAW_CATEGORIES = [
    "aircraft carrier","airplane","alarm clock","ambulance","angel","animal migration",
    "ant","anvil","apple","arm","asparagus","axe","backpack","banana","bandage","barn",
    "baseball","baseball bat","basket","basketball","bat","bathtub","beach","bear",
    "beard","bed","bee","belt","bench","bicycle","binoculars","bird","birthday cake",
    "blackberry","blueberry","book","boomerang","bottlecap","bowtie","bracelet","brain",
    "bread","bridge","broccoli","broom","bucket","bulldozer","bus","bush","butterfly",
    "cactus","cake","calculator","calendar","camel","camera","camouflage","campfire",
    "candle","cannon","canoe","car","carrot","castle","cat","ceiling fan","cello",
    "cell phone","chair","chandelier","church","circle","clarinet","clock","cloud",
    "coffee cup","compass","computer","cookie","cooler","couch","cow","crab","crayon",
    "crocodile","crown","cruise ship","cup","diamond","dishwasher","diving board",
    "dog","dolphin","donut","door","dragon","dresser","drill","drums","duck",
    "dumbbell","ear","elbow","elephant","envelope","eraser","eye","eyeglasses",
    "face","fan","feather","fence","finger","fire hydrant","fireplace","firetruck",
    "fish","flamingo","flashlight","flip flops","floor lamp","flower","flying saucer",
    "foot","fork","frog","frying pan","garden","garden hose","giraffe","goatee",
    "golf club","grapes","grass","guitar","hamburger","hammer","hand","harp","hat",
    "headphones","hedgehog","helicopter","helmet","hexagon","hockey puck","hockey stick",
    "horse","hospital","hot air balloon","hot dog","hot tub","hourglass","house",
    "house plant","hurricane","ice cream","jacket","jail","kangaroo","key","keyboard",
    "knee","knife","ladder","lantern","laptop","leaf","leg","light bulb","lighter",
    "lighthouse","lightning","line","lion","lipstick","lobster","lollipop","mailbox",
    "map","marker","matches","megaphone","mermaid","microphone","microwave","monkey",
    "moon","mosquito","motorbike","mountain","mouse","moustache","mouth","mug",
    "mushroom","nail","necklace","nose","ocean","octagon","octopus","onion","oven",
    "owl","paintbrush","paint can","palm tree","panda","pants","paper clip","parachute",
    "parrot","passport","peanut","pear","peas","pencil","penguin","piano","pickup truck",
    "picture frame","pig","pillow","pineapple","pizza","pliers","police car","pond",
    "pool","popsicle","postcard","potato","power outlet","purse","rabbit","raccoon",
    "radio","rain","rainbow","rake","remote control","rhinoceros","rifle","river",
    "roller coaster","rollerskates","sailboat","sandwich","saw","saxophone","school bus",
    "scissors","scorpion","screwdriver","sea turtle","see saw","shark","sheep","shoe",
    "shorts","shovel","sink","skateboard","skull","skyscraper","sleeping bag",
    "smiley face","snail","snake","snorkel","snowflake","snowman","soccer ball","sock",
    "speedboat","spider","spoon","spreadsheet","square","squiggle","squirrel","stairs",
    "star","steak","stereo","stethoscope","stitches","stop sign","stove","strawberry",
    "streetlight","string bean","submarine","suitcase","sun","swan","sweater",
    "swing set","sword","syringe","table","teapot","teddy-bear","telephone","television",
    "tennis racquet","tent","The Eiffel Tower","The Great Wall of China","The Mona Lisa",
    "tiger","toaster","toe","toilet","tooth","toothbrush","toothpaste","tornado",
    "tractor","traffic light","train","tree","triangle","trombone","truck","trumpet",
    "t-shirt","umbrella","underwear","van","vase","violin","washing machine","watermelon",
    "waterslide","whale","wheel","windmill","wine bottle","wine glass","wristwatch",
    "yoga","zebra","zigzag",
]

_CATEGORY_SET = frozenset(c.lower() for c in _QUICKDRAW_CATEGORIES)
_CAT_LOWER_MAP = {c.lower(): c for c in _QUICKDRAW_CATEGORIES}

_PROMPT = (
    "This is a simple hand-drawn sketch on a white background. "
    "Identify which ONE of the following Google QuickDraw categories it belongs to. "
    "Reply with ONLY the category name, exactly as written, nothing else. "
    "Do not add punctuation or explanation.\n\n"
    "Categories: " + ", ".join(_QUICKDRAW_CATEGORIES)
)

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-1.5-flash:generateContent?key={key}"
)


def classify_with_gemini(png_path: str) -> tuple[str, float] | None:
    """
    Classify a sketch PNG using Gemini Vision via REST API.
    Returns (category, confidence_pct) or None if unavailable/failed.
    """
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return None

    try:
        with open(png_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")

        payload = json.dumps({
            "contents": [{
                "parts": [
                    {"text": _PROMPT},
                    {"inline_data": {"mime_type": "image/png", "data": img_b64}},
                ]
            }],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 32,
            },
        }).encode("utf-8")

        url = _GEMINI_URL.format(key=api_key)
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        raw = (
            data["candidates"][0]["content"]["parts"][0]["text"]
            .strip()
            .lower()
            .strip("\"'.,;: \n")
        )

        # Exact match
        if raw in _CATEGORY_SET:
            return _CAT_LOWER_MAP[raw], 97.0

        # Partial / fuzzy match
        best_cat, best_score = None, 0
        for cat_l, cat in _CAT_LOWER_MAP.items():
            if cat_l in raw or raw in cat_l:
                score = len(set(cat_l.split()) & set(raw.split()))
                if score > best_score:
                    best_score, best_cat = score, cat
        if best_cat:
            return best_cat, 85.0

        return None

    except Exception as e:
        print(f"[Gemini REST] error: {e}")
        return None
