from enum import Enum


class AnimationType(Enum):
    SWAY = "sway"         # trees, tall thin objects — pivot at base, top oscillates
    DRIFT = "drift"       # clouds, floating/light objects — gentle Lissajous translation
    SPIN = "spin"         # sun, radial objects — slow oscillating rotation
    BOUNCE = "bounce"     # food, round objects — vertical bounce with squash
    WIGGLE = "wiggle"     # amorphous/generic — rocking rotation
    SWIM = "swim"         # fish — body-wave propagating tail-to-head
    WALK = "walk"         # legged animals — body bob + slight sway (no limbs detected)
    SHAKE = "shake"       # furniture — rapid irregular x-jitter
    SKELETAL = "skeletal" # animals — auto-detect limbs, pendulum joint animation


CATEGORY_MAP = {
    # Weather / sky
    "sun": AnimationType.SPIN,
    "cloud": AnimationType.DRIFT,
    "rain": AnimationType.DRIFT,
    "snow": AnimationType.DRIFT,
    "umbrella": AnimationType.DRIFT,
    "smoke": AnimationType.DRIFT,
    "cigarette": AnimationType.DRIFT,
    # Nature
    "tree": AnimationType.SWAY,
    "plant": AnimationType.SWAY,
    "flower": AnimationType.SWAY,
    "grass": AnimationType.SWAY,
    "leaf": AnimationType.DRIFT,
    "mushroom": AnimationType.WIGGLE,
    # Animals — skeletal (limb pendulum) where possible
    "fish": AnimationType.SWIM,
    "bird": AnimationType.DRIFT,
    "sheep": AnimationType.SKELETAL,
    "camel": AnimationType.SKELETAL,
    "dog": AnimationType.SKELETAL,
    "cat": AnimationType.SKELETAL,
    "horse": AnimationType.SKELETAL,
    "cow": AnimationType.SKELETAL,
    "elephant": AnimationType.SKELETAL,
    "lion": AnimationType.SKELETAL,
    "animal": AnimationType.SKELETAL,
    # Food
    "cupcake": AnimationType.BOUNCE,
    "cake": AnimationType.BOUNCE,
    "burger": AnimationType.BOUNCE,
    "sandwich": AnimationType.BOUNCE,
    "ice_cream": AnimationType.SWAY,
    "icecream": AnimationType.SWAY,
    "pizza": AnimationType.SPIN,
    "donut": AnimationType.SPIN,
    "food": AnimationType.BOUNCE,
    # Furniture / objects
    "sofa": AnimationType.SHAKE,
    "chair": AnimationType.SHAKE,
    "table": AnimationType.SHAKE,
    "furniture": AnimationType.SHAKE,
    "pavilion": AnimationType.SWAY,
    "house": AnimationType.SHAKE,
    "building": AnimationType.SHAKE,
    # Containers / scenes
    "fish_tank": AnimationType.WIGGLE,
    "aquarium": AnimationType.WIGGLE,
    "fishbowl": AnimationType.WIGGLE,
    "bowl": AnimationType.BOUNCE,
    
    # High-level merged AI categories
    "four_legged_animals": AnimationType.SKELETAL,
    "weather_or_sky": AnimationType.DRIFT,
    "nature": AnimationType.SWAY,
}


def get_animation_type(category: str) -> AnimationType:
    """Map a recognized category string to an AnimationType."""
    key = category.lower().strip().replace(" ", "_")

    if key in CATEGORY_MAP:
        return CATEGORY_MAP[key]

    # Partial / substring match
    for cat, anim in CATEGORY_MAP.items():
        if cat in key or key in cat:
            return anim

    return AnimationType.WIGGLE  # default fallback
