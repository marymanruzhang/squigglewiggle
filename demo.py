"""
Demo: animate all Participant 12 - B sample drawings.

Categories are manually assigned here (simulating recognition output).
In production, swap these for your recognition system's output.
"""

import os
from animation_engine import animate

SAMPLES_DIR = "Participant 12 - B"
OUTPUT_DIR  = "output"

# recognition output keyed by filename
# "category"        → animate the whole image as one object
# "objects"         → animate each object separately
#   with "bbox"     → use provided bounding box
#   without "bbox"  → auto-segment and assign categories by spatial order
ANNOTATIONS = {
    # Sky / weather scene — sun top-centre, clouds scattered, trees bottom
    "round_01.png": {
        "objects": [
            # auto-segment; assign in top→bottom, left→right order:
            # detected order will be: sun, left-cloud, right-cloud, bottom-cloud, left-tree, right-tree
            {"category": "sun"},
            {"category": "cloud"},
            {"category": "cloud"},
            {"category": "cloud"},
            {"category": "tree"},
            {"category": "tree"},
        ]
    },
    # Sheep with cloud-like body and rain-drop legs
    "round_03.png": {"category": "sheep"},
    # Camel built from a cloud body — labelled "CAMEL"
    "round_04.png": {"category": "camel"},
    # Cloud + umbrella + rain drops
    "round_05.png": {"category": "cloud"},
    # Mushroom
    "round_06.png": {"category": "mushroom"},
    # Cupcake with candle
    "round_07.png": {"category": "cupcake"},
    # Sofa labelled "sofa"
    "round_08.png": {"category": "sofa"},
    # Pavilion built from a cloud — labelled "pavilion"
    "round_09.png": {"category": "pavilion"},
    # Cigarette + smoke cloud
    "round_11.png": {"category": "cigarette"},
    # Burger / sandwich
    "round_12.png": {"category": "burger"},
    # Ice-cream cone
    "round_13.png": {"category": "ice_cream"},
    # Tree (complex, multi-stroke)
    "round_14.png": {"category": "tree"},
    # Fish bowl / aquarium with three fish
    "round_15.png": {
        "objects": [
            # bowl first, then fish (auto-segmented by spatial order)
            {"category": "fishbowl"},
            {"category": "fish"},
            {"category": "fish"},
            {"category": "fish"},
        ]
    },
}


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for filename, recognition in ANNOTATIONS.items():
        src = os.path.join(SAMPLES_DIR, filename)
        dst = os.path.join(OUTPUT_DIR, filename.replace(".png", ".gif"))
        print(f"animating {filename} …")
        try:
            animate(src, recognition, dst)
        except Exception as e:
            print(f"  ERROR: {e}")

    print("\nDone. GIFs are in:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
