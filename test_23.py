import os
from animation_engine import animate

SAMPLES_DIR = "Participant 23"
OUTPUT_DIR  = "output_23"

# recognition output keyed by filename
ANNOTATIONS = {
    "Copy of round_01.png": {"category": "sun"},
    "Copy of round_02.png": {"category": "bird"},
    "Copy of round_03.png": {"category": "sheep"},
    "Copy of round_04.png": {"category": "camel"},
    "Copy of round_05.png": {"category": "cloud"},
    "Copy of round_06.png": {"category": "mushroom"},
    "Copy of round_07.png": {"category": "fish"},
    "Copy of round_08.png": {"category": "sofa"},
    "Copy of round_09.png": {"category": "pavilion"},
    "Copy of round_10.png": {"category": "bowl"},
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

