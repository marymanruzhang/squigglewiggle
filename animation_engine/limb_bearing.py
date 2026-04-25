"""
Limb / character animation routing (inspired by Meta *AnimatedDrawings*:

  A Method for Animating Children's Drawings of the Human Figure, IC 2022).

The full `facebookresearch/AnimatedDrawings` stack (instance segmentation, pose
estimation, BVH retargeting) is not bundled here — it is heavy and archived.
This project uses a lightweight, same-purpose path: piecewise-affine *mesh* warping
+ walk phases in `skeletal.py`, which is only selected for **sketches that
represent limbed animals or humanoid figures** expected to have legs/arms
visible in a typical child's drawing.

For all other object classes, `category_map.CATEGORY_MAP` picks coherent motion
(sway, drift, swim, flap, hop, crawl, …).

NOTE: Birds, butterflies, bees, frogs, rabbits, kangaroos, spiders, scorpions,
ants, crabs etc. are intentionally NOT in LIMB_MESH_CATEGORIES.  They are
handled by the more appropriate FLAP / HOP / CRAWL animations in category_map.
"""

from __future__ import annotations

# QuickDraw labels → limb mesh (piecewise-affine walk cycle in skeletal.py).
# Keep only true four-legged walking / running animals and humanoid figures.
# Flappers (bird, butterfly, bee, …) → FLAP in category_map
# Hoppers  (frog, rabbit, kangaroo)  → HOP  in category_map
# Crawlers (spider, ant, scorpion, crab, …) → CRAWL in category_map
LIMB_MESH_CATEGORIES: frozenset[str] = frozenset({
    "four_legged_animals",  # legacy mega-category
    "bear",
    "camel",
    "cat",
    "cow",
    "crocodile",
    "dog",
    "elephant",
    "flamingo",
    "giraffe",
    "horse",
    "lion",
    "monkey",
    "mouse",
    "panda",
    "penguin",
    "pig",
    "raccoon",
    "rhinoceros",
    "sheep",
    "squirrel",
    "swan",
    "teddy-bear",
    "tiger",
    "zebra",
})

# Explicitly *not* limb mesh: use their category_map motion type instead.
_NOT_LIMB: frozenset[str] = frozenset({
    "snail",
    "snake",
    # flappers
    "bird", "butterfly", "bee", "bat", "owl", "parrot", "duck", "mosquito",
    "angel", "dragon",
    # hoppers
    "frog", "rabbit", "kangaroo",
    # crawlers
    "spider", "ant", "scorpion", "crab", "lobster", "octopus", "hedgehog",
})


def _norm_key(s: str) -> str:
    t = s.strip().lower().replace("_", " ").replace("-", " ")
    return " ".join(t.split())


_LIMB_N:    frozenset[str] = frozenset(_norm_key(x) for x in LIMB_MESH_CATEGORIES)
_NOTLIMB_N: frozenset[str] = frozenset(_norm_key(x) for x in _NOT_LIMB)


def should_use_limb_mesh(classifier_label: str) -> bool:
    """
    If True,  use `skeletal.generate_skeletal_frames` (2D skinned mesh + walk).
    If False, use the motion type from `CATEGORY_MAP`.
    """
    n = _norm_key(classifier_label)
    if not n:
        return False
    if n in _NOTLIMB_N:
        return False
    return n in _LIMB_N
