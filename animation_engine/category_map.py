from __future__ import annotations

from enum import Enum

from .limb_bearing import should_use_limb_mesh


class AnimationType(Enum):
    SWAY     = "sway"      # trees, tall thin objects — pivot at base, top oscillates
    DRIFT    = "drift"     # clouds, floating/light objects — gentle Lissajous translation
    SPIN     = "spin"      # sun, radial objects — slow oscillating rotation
    BOUNCE   = "bounce"    # food, round objects — vertical bounce with squash
    WIGGLE   = "wiggle"    # amorphous/generic — rocking rotation
    SWIM     = "swim"      # fish — body-wave propagating tail-to-head
    WALK     = "walk"      # legged animals — body bob + slight sway (no limbs detected)
    SHAKE    = "shake"     # furniture — rapid irregular x-jitter
    SKELETAL = "skeletal"  # four-legged animals — auto-detect limbs, pendulum joint walk
    FLAP     = "flap"      # birds, butterflies, bees — wing-beat mesh oscillation
    HOP      = "hop"       # frog, rabbit, kangaroo — squash-and-stretch vertical hop
    CRAWL    = "crawl"     # spider, ant, scorpion, crab — horizontal body-wave


CATEGORY_MAP: dict[str, AnimationType] = {
    # ── A ──────────────────────────────────────────────────────────────────
    "aircraft carrier":         AnimationType.SHAKE,
    "airplane":                 AnimationType.DRIFT,
    "alarm clock":              AnimationType.SPIN,
    "ambulance":                AnimationType.SHAKE,
    "angel":                    AnimationType.FLAP,
    "animal migration":         AnimationType.DRIFT,
    "ant":                      AnimationType.CRAWL,
    "anvil":                    AnimationType.WIGGLE,
    "apple":                    AnimationType.BOUNCE,
    "arm":                      AnimationType.WIGGLE,
    "asparagus":                AnimationType.SWAY,
    "axe":                      AnimationType.WIGGLE,
    # ── B ──────────────────────────────────────────────────────────────────
    "backpack":                 AnimationType.WIGGLE,
    "banana":                   AnimationType.WIGGLE,
    "bandage":                  AnimationType.WIGGLE,
    "barn":                     AnimationType.WIGGLE,
    "baseball":                 AnimationType.SPIN,
    "baseball bat":             AnimationType.WIGGLE,
    "basket":                   AnimationType.WIGGLE,
    "basketball":               AnimationType.SPIN,
    "bat":                      AnimationType.FLAP,       # flying bat
    "bathtub":                  AnimationType.DRIFT,
    "beach":                    AnimationType.WIGGLE,
    "bear":                     AnimationType.SKELETAL,
    "beard":                    AnimationType.WIGGLE,
    "bed":                      AnimationType.SHAKE,
    "bee":                      AnimationType.FLAP,
    "belt":                     AnimationType.WIGGLE,
    "bench":                    AnimationType.SHAKE,
    "bicycle":                  AnimationType.SPIN,
    "binoculars":               AnimationType.WIGGLE,
    "bird":                     AnimationType.FLAP,
    "birthday cake":            AnimationType.BOUNCE,
    "blackberry":               AnimationType.BOUNCE,
    "blueberry":                AnimationType.BOUNCE,
    "book":                     AnimationType.WIGGLE,
    "boomerang":                AnimationType.DRIFT,
    "bottlecap":                AnimationType.WIGGLE,
    "bowtie":                   AnimationType.BOUNCE,
    "bracelet":                 AnimationType.WIGGLE,
    "brain":                    AnimationType.DRIFT,
    "bread":                    AnimationType.BOUNCE,
    "bridge":                   AnimationType.WIGGLE,
    "broccoli":                 AnimationType.BOUNCE,
    "broom":                    AnimationType.WIGGLE,
    "bucket":                   AnimationType.WIGGLE,
    "bulldozer":                AnimationType.SHAKE,
    "bus":                      AnimationType.SHAKE,
    "bush":                     AnimationType.SWAY,
    "butterfly":                AnimationType.FLAP,
    # ── C ──────────────────────────────────────────────────────────────────
    "cactus":                   AnimationType.SWAY,
    "cake":                     AnimationType.BOUNCE,
    "calculator":               AnimationType.WIGGLE,
    "calendar":                 AnimationType.WIGGLE,
    "camel":                    AnimationType.SKELETAL,
    "camera":                   AnimationType.SHAKE,
    "camouflage":               AnimationType.WIGGLE,
    "campfire":                 AnimationType.WIGGLE,
    "candle":                   AnimationType.WIGGLE,
    "cannon":                   AnimationType.WIGGLE,
    "canoe":                    AnimationType.SWIM,
    "car":                      AnimationType.SHAKE,
    "carrot":                   AnimationType.BOUNCE,
    "castle":                   AnimationType.WIGGLE,
    "cat":                      AnimationType.SKELETAL,
    "ceiling fan":              AnimationType.SPIN,
    "cello":                    AnimationType.WIGGLE,
    "cell phone":               AnimationType.WIGGLE,
    "chair":                    AnimationType.SHAKE,
    "chandelier":               AnimationType.WIGGLE,
    "church":                   AnimationType.WIGGLE,
    "circle":                   AnimationType.SPIN,
    "clarinet":                 AnimationType.WIGGLE,
    "clock":                    AnimationType.SPIN,
    "cloud":                    AnimationType.DRIFT,
    "coffee cup":               AnimationType.WIGGLE,
    "compass":                  AnimationType.SPIN,
    "computer":                 AnimationType.SHAKE,
    "cookie":                   AnimationType.BOUNCE,
    "cooler":                   AnimationType.WIGGLE,
    "couch":                    AnimationType.SHAKE,
    "cow":                      AnimationType.SKELETAL,
    "crab":                     AnimationType.CRAWL,
    "crayon":                   AnimationType.WIGGLE,
    "crocodile":                AnimationType.SKELETAL,
    "crown":                    AnimationType.WIGGLE,
    "cruise ship":              AnimationType.SWIM,
    "cup":                      AnimationType.WIGGLE,
    # ── D ──────────────────────────────────────────────────────────────────
    "diamond":                  AnimationType.WIGGLE,
    "dishwasher":               AnimationType.SHAKE,
    "diving board":             AnimationType.WIGGLE,
    "dog":                      AnimationType.SKELETAL,
    "dolphin":                  AnimationType.SWIM,
    "donut":                    AnimationType.SPIN,
    "door":                     AnimationType.WIGGLE,
    "dragon":                   AnimationType.FLAP,
    "dresser":                  AnimationType.SHAKE,
    "drill":                    AnimationType.WIGGLE,
    "drums":                    AnimationType.WIGGLE,
    "duck":                     AnimationType.FLAP,
    "dumbbell":                 AnimationType.WIGGLE,
    # ── E ──────────────────────────────────────────────────────────────────
    "ear":                      AnimationType.WIGGLE,
    "elbow":                    AnimationType.WIGGLE,
    "elephant":                 AnimationType.SKELETAL,
    "envelope":                 AnimationType.WIGGLE,
    "eraser":                   AnimationType.WIGGLE,
    "eye":                      AnimationType.WIGGLE,
    "eyeglasses":               AnimationType.WIGGLE,
    # ── F ──────────────────────────────────────────────────────────────────
    "face":                     AnimationType.BOUNCE,
    "fan":                      AnimationType.SPIN,
    "feather":                  AnimationType.DRIFT,
    "fence":                    AnimationType.WIGGLE,
    "finger":                   AnimationType.WIGGLE,
    "fire hydrant":             AnimationType.WIGGLE,
    "fireplace":                AnimationType.WIGGLE,
    "firetruck":                AnimationType.SHAKE,
    "fish":                     AnimationType.SWIM,
    "flamingo":                 AnimationType.SKELETAL,
    "flashlight":               AnimationType.WIGGLE,
    "flip flops":               AnimationType.WIGGLE,
    "floor lamp":               AnimationType.WIGGLE,
    "flower":                   AnimationType.SWAY,
    "flying saucer":            AnimationType.DRIFT,
    "foot":                     AnimationType.WIGGLE,
    "fork":                     AnimationType.WIGGLE,
    "frog":                     AnimationType.HOP,
    "frying pan":               AnimationType.WIGGLE,
    # ── G ──────────────────────────────────────────────────────────────────
    "garden":                   AnimationType.WIGGLE,
    "garden hose":              AnimationType.WIGGLE,
    "giraffe":                  AnimationType.SKELETAL,
    "goatee":                   AnimationType.WIGGLE,
    "golf club":                AnimationType.WIGGLE,
    "grapes":                   AnimationType.BOUNCE,
    "grass":                    AnimationType.SWAY,
    "guitar":                   AnimationType.WIGGLE,
    # ── H ──────────────────────────────────────────────────────────────────
    "hamburger":                AnimationType.BOUNCE,
    "hammer":                   AnimationType.WIGGLE,
    "hand":                     AnimationType.WIGGLE,
    "harp":                     AnimationType.WIGGLE,
    "hat":                      AnimationType.WIGGLE,
    "headphones":               AnimationType.WIGGLE,
    "hedgehog":                 AnimationType.CRAWL,
    "helicopter":               AnimationType.DRIFT,
    "helmet":                   AnimationType.WIGGLE,
    "hexagon":                  AnimationType.SPIN,
    "hockey puck":              AnimationType.WIGGLE,
    "hockey stick":             AnimationType.WIGGLE,
    "horse":                    AnimationType.SKELETAL,
    "hospital":                 AnimationType.WIGGLE,
    "hot air balloon":          AnimationType.DRIFT,
    "hot dog":                  AnimationType.BOUNCE,
    "hot tub":                  AnimationType.WIGGLE,
    "hourglass":                AnimationType.WIGGLE,
    "house":                    AnimationType.WIGGLE,
    "house plant":              AnimationType.SWAY,
    "hurricane":                AnimationType.DRIFT,
    # ── I ──────────────────────────────────────────────────────────────────
    "ice cream":                AnimationType.BOUNCE,
    # ── J ──────────────────────────────────────────────────────────────────
    "jacket":                   AnimationType.WIGGLE,
    "jail":                     AnimationType.WIGGLE,
    # ── K ──────────────────────────────────────────────────────────────────
    "kangaroo":                 AnimationType.HOP,
    "key":                      AnimationType.WIGGLE,
    "keyboard":                 AnimationType.SHAKE,
    "knee":                     AnimationType.WIGGLE,
    "knife":                    AnimationType.WIGGLE,
    # ── L ──────────────────────────────────────────────────────────────────
    "ladder":                   AnimationType.WIGGLE,
    "lantern":                  AnimationType.SWAY,
    "laptop":                   AnimationType.SHAKE,
    "leaf":                     AnimationType.SWAY,
    "leg":                      AnimationType.WIGGLE,
    "light bulb":               AnimationType.WIGGLE,
    "lighter":                  AnimationType.WIGGLE,
    "lighthouse":               AnimationType.WIGGLE,
    "lightning":                AnimationType.DRIFT,
    "line":                     AnimationType.WIGGLE,
    "lion":                     AnimationType.SKELETAL,
    "lipstick":                 AnimationType.WIGGLE,
    "lobster":                  AnimationType.CRAWL,
    "lollipop":                 AnimationType.WIGGLE,
    # ── M ──────────────────────────────────────────────────────────────────
    "mailbox":                  AnimationType.WIGGLE,
    "map":                      AnimationType.WIGGLE,
    "marker":                   AnimationType.WIGGLE,
    "matches":                  AnimationType.WIGGLE,
    "megaphone":                AnimationType.WIGGLE,
    "mermaid":                  AnimationType.SWIM,
    "microphone":               AnimationType.WIGGLE,
    "microwave":                AnimationType.SHAKE,
    "monkey":                   AnimationType.SKELETAL,
    "moon":                     AnimationType.DRIFT,
    "mosquito":                 AnimationType.FLAP,
    "motorbike":                AnimationType.WIGGLE,
    "mountain":                 AnimationType.WIGGLE,
    "mouse":                    AnimationType.SKELETAL,
    "moustache":                AnimationType.WIGGLE,
    "mouth":                    AnimationType.WIGGLE,
    "mug":                      AnimationType.WIGGLE,
    "mushroom":                 AnimationType.BOUNCE,
    # ── N ──────────────────────────────────────────────────────────────────
    "nail":                     AnimationType.WIGGLE,
    "necklace":                 AnimationType.WIGGLE,
    "nose":                     AnimationType.WIGGLE,
    # ── O ──────────────────────────────────────────────────────────────────
    "ocean":                    AnimationType.SWIM,
    "octagon":                  AnimationType.SPIN,
    "octopus":                  AnimationType.CRAWL,
    "onion":                    AnimationType.BOUNCE,
    "oven":                     AnimationType.SHAKE,
    "owl":                      AnimationType.FLAP,
    # ── P ──────────────────────────────────────────────────────────────────
    "paintbrush":               AnimationType.WIGGLE,
    "paint can":                AnimationType.WIGGLE,
    "palm tree":                AnimationType.SWAY,
    "panda":                    AnimationType.SKELETAL,
    "pants":                    AnimationType.WIGGLE,
    "paper clip":               AnimationType.WIGGLE,
    "parachute":                AnimationType.DRIFT,
    "parrot":                   AnimationType.FLAP,
    "passport":                 AnimationType.WIGGLE,
    "peanut":                   AnimationType.BOUNCE,
    "pear":                     AnimationType.BOUNCE,
    "peas":                     AnimationType.WIGGLE,
    "pencil":                   AnimationType.WIGGLE,
    "penguin":                  AnimationType.SKELETAL,
    "piano":                    AnimationType.SHAKE,
    "pickup truck":             AnimationType.SHAKE,
    "picture frame":            AnimationType.WIGGLE,
    "pig":                      AnimationType.SKELETAL,
    "pillow":                   AnimationType.WIGGLE,
    "pineapple":                AnimationType.BOUNCE,
    "pizza":                    AnimationType.SPIN,
    "pliers":                   AnimationType.WIGGLE,
    "police car":               AnimationType.SHAKE,
    "pond":                     AnimationType.SWIM,
    "pool":                     AnimationType.SWIM,
    "popsicle":                 AnimationType.BOUNCE,
    "postcard":                 AnimationType.SHAKE,
    "potato":                   AnimationType.BOUNCE,
    "power outlet":             AnimationType.WIGGLE,
    "purse":                    AnimationType.WIGGLE,
    # ── R ──────────────────────────────────────────────────────────────────
    "rabbit":                   AnimationType.HOP,
    "raccoon":                  AnimationType.SKELETAL,
    "radio":                    AnimationType.SHAKE,
    "rain":                     AnimationType.DRIFT,
    "rainbow":                  AnimationType.DRIFT,
    "rake":                     AnimationType.WIGGLE,
    "remote control":           AnimationType.WIGGLE,
    "rhinoceros":               AnimationType.SKELETAL,
    "rifle":                    AnimationType.WIGGLE,
    "river":                    AnimationType.SWIM,
    "roller coaster":           AnimationType.WIGGLE,
    "rollerskates":             AnimationType.WIGGLE,
    # ── S ──────────────────────────────────────────────────────────────────
    "sailboat":                 AnimationType.SWIM,
    "sandwich":                 AnimationType.BOUNCE,
    "saw":                      AnimationType.WIGGLE,
    "saxophone":                AnimationType.WIGGLE,
    "school bus":               AnimationType.SHAKE,
    "scissors":                 AnimationType.WIGGLE,
    "scorpion":                 AnimationType.CRAWL,
    "screwdriver":              AnimationType.WIGGLE,
    "sea turtle":               AnimationType.SWIM,
    "see saw":                  AnimationType.WIGGLE,
    "shark":                    AnimationType.SWIM,
    "sheep":                    AnimationType.SKELETAL,
    "shoe":                     AnimationType.WIGGLE,
    "shorts":                   AnimationType.WIGGLE,
    "shovel":                   AnimationType.WIGGLE,
    "sink":                     AnimationType.WIGGLE,
    "skateboard":               AnimationType.WIGGLE,
    "skull":                    AnimationType.WIGGLE,
    "skyscraper":               AnimationType.WIGGLE,
    "sleeping bag":             AnimationType.WIGGLE,
    "smiley face":              AnimationType.BOUNCE,
    "snail":                    AnimationType.CRAWL,
    "snake":                    AnimationType.SWIM,
    "snorkel":                  AnimationType.WIGGLE,
    "snowflake":                AnimationType.DRIFT,
    "snowman":                  AnimationType.WIGGLE,
    "soccer ball":              AnimationType.BOUNCE,
    "sock":                     AnimationType.WIGGLE,
    "speedboat":                AnimationType.SWIM,
    "spider":                   AnimationType.CRAWL,
    "spoon":                    AnimationType.WIGGLE,
    "spreadsheet":              AnimationType.WIGGLE,
    "square":                   AnimationType.WIGGLE,
    "squiggle":                 AnimationType.WIGGLE,
    "squirrel":                 AnimationType.SKELETAL,
    "stairs":                   AnimationType.WIGGLE,
    "star":                     AnimationType.DRIFT,
    "steak":                    AnimationType.BOUNCE,
    "stereo":                   AnimationType.SHAKE,
    "stethoscope":              AnimationType.WIGGLE,
    "stitches":                 AnimationType.WIGGLE,
    "stop sign":                AnimationType.WIGGLE,
    "stove":                    AnimationType.SHAKE,
    "strawberry":               AnimationType.BOUNCE,
    "streetlight":              AnimationType.SWAY,
    "string bean":              AnimationType.SWAY,
    "submarine":                AnimationType.SWIM,
    "suitcase":                 AnimationType.WIGGLE,
    "sun":                      AnimationType.DRIFT,
    "swan":                     AnimationType.SKELETAL,
    "sweater":                  AnimationType.WIGGLE,
    "swing set":                AnimationType.WIGGLE,
    "sword":                    AnimationType.WIGGLE,
    "syringe":                  AnimationType.WIGGLE,
    # ── T ──────────────────────────────────────────────────────────────────
    "table":                    AnimationType.SHAKE,
    "teapot":                   AnimationType.WIGGLE,
    "teddy-bear":               AnimationType.SKELETAL,
    "telephone":                AnimationType.SHAKE,
    "television":               AnimationType.SHAKE,
    "tennis racquet":           AnimationType.WIGGLE,
    "tent":                     AnimationType.WIGGLE,
    "The Eiffel Tower":         AnimationType.WIGGLE,
    "The Great Wall of China":  AnimationType.WIGGLE,
    "The Mona Lisa":            AnimationType.WIGGLE,
    "tiger":                    AnimationType.SKELETAL,
    "toaster":                  AnimationType.WIGGLE,
    "toe":                      AnimationType.WIGGLE,
    "toilet":                   AnimationType.WIGGLE,
    "tooth":                    AnimationType.WIGGLE,
    "toothbrush":               AnimationType.WIGGLE,
    "toothpaste":               AnimationType.WIGGLE,
    "tornado":                  AnimationType.DRIFT,
    "tractor":                  AnimationType.SHAKE,
    "traffic light":            AnimationType.WIGGLE,
    "train":                    AnimationType.DRIFT,
    "tree":                     AnimationType.SWAY,
    "triangle":                 AnimationType.WIGGLE,
    "trombone":                 AnimationType.WIGGLE,
    "truck":                    AnimationType.SHAKE,
    "trumpet":                  AnimationType.WIGGLE,
    "t-shirt":                  AnimationType.WIGGLE,
    # ── U ──────────────────────────────────────────────────────────────────
    "umbrella":                 AnimationType.WIGGLE,
    "underwear":                AnimationType.WIGGLE,
    # ── V ──────────────────────────────────────────────────────────────────
    "van":                      AnimationType.SHAKE,
    "vase":                     AnimationType.WIGGLE,
    "violin":                   AnimationType.WIGGLE,
    # ── W ──────────────────────────────────────────────────────────────────
    "washing machine":          AnimationType.SHAKE,
    "watermelon":               AnimationType.BOUNCE,
    "waterslide":               AnimationType.WIGGLE,
    "whale":                    AnimationType.SWIM,
    "wheel":                    AnimationType.SPIN,
    "windmill":                 AnimationType.SPIN,
    "wine bottle":              AnimationType.WIGGLE,
    "wine glass":               AnimationType.WIGGLE,
    "wristwatch":               AnimationType.WIGGLE,
    # ── Y / Z ──────────────────────────────────────────────────────────────
    "yoga":                     AnimationType.WIGGLE,
    "zebra":                    AnimationType.SKELETAL,
    "zigzag":                   AnimationType.WIGGLE,
    # ── extras ─────────────────────────────────────────────────────────────
    "popcorn":                  AnimationType.BOUNCE,
}


def get_animation_type(category: str) -> AnimationType:
    """
    Map a recognized category string to an AnimationType.
    Limbed animals / humanoid figures use the SKELETAL walk path;
    all other classes use the coherent motion in CATEGORY_MAP.
    """
    raw = (category or "").strip()
    if not raw:
        return AnimationType.WIGGLE
    if should_use_limb_mesh(raw):
        return AnimationType.SKELETAL

    def norm(s: str) -> str:
        return s.lower().strip()

    n = norm(raw)
    n_space = n.replace("_", " ")
    n_underscore = n.replace(" ", "_")

    for cat, anim in CATEGORY_MAP.items():
        if not isinstance(cat, str):
            continue
        c = norm(cat)
        if n == c or n_space == c or n_underscore == c.replace(" ", "_"):
            return anim

    # Substring: prefer the longest category name to reduce false hits
    best: tuple[int, AnimationType] | None = None
    for cat, anim in CATEGORY_MAP.items():
        if not isinstance(cat, str):
            continue
        c = norm(cat)
        if not c:
            continue
        if c in n_space or n_space in c:
            L = len(cat)
            if best is None or L > best[0]:
                best = (L, anim)
    if best is not None:
        return best[1]
    return AnimationType.WIGGLE


# Legacy mega-categories for backward compatibility
CATEGORY_MAP["four_legged_animals"] = AnimationType.SKELETAL
CATEGORY_MAP["nature"]              = AnimationType.SWAY
CATEGORY_MAP["weather_or_sky"]      = AnimationType.DRIFT
CATEGORY_MAP["furniture"]           = AnimationType.SHAKE
CATEGORY_MAP["food"]                = AnimationType.BOUNCE
