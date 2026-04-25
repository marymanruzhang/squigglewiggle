import os
import urllib.request
import concurrent.futures
import numpy as np
from train import CATEGORIES

QUICKDRAW_BASE = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/"
DATA_DIR = "quickdraw_data"
os.makedirs(DATA_DIR, exist_ok=True)

def download_one(cat):
    filename = f"{cat}.npy"
    filepath = os.path.join(DATA_DIR, filename)
    url = QUICKDRAW_BASE + filename.replace(" ", "%20")
    
    # Check if exists and valid
    if os.path.exists(filepath):
        try:
            # Check if it loads perfectly
            np.load(filepath, mmap_mode='r')
            return
        except:
            os.remove(filepath)
    
    try:
        urllib.request.urlretrieve(url, filepath)
        print(f"Downloaded {filename}")
    except Exception as e:
        print(f"Failed {filename}: {e}")

def download_datasets():
    print(f"Downloading {len(CATEGORIES)} categories in parallel...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        executor.map(download_one, CATEGORIES)

if __name__ == "__main__":
    download_datasets()
