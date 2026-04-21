import os
import urllib.request

QUICKDRAW_BASE = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/"

CATEGORIES = [
    "flower", "tree",         
    "sun", "cloud",           
    "cat", "dog", "horse",    
    "fish",                   
    "bird",                   
    "hamburger", "cupcake",   
    "chair", "table"          
]

DATA_DIR = "quickdraw_data"
os.makedirs(DATA_DIR, exist_ok=True)

def download_datasets():
    for cat in CATEGORIES:
        filename = f"{cat}.npy"
        filepath = os.path.join(DATA_DIR, filename)
        url = QUICKDRAW_BASE + filename.replace(" ", "%20")
        
        if not os.path.exists(filepath):
            print(f"Downloading {filename}...")
            try:
                urllib.request.urlretrieve(url, filepath)
                print(f"Successfully downloaded {filename}.")
            except Exception as e:
                print(f"Failed to download {filename}: {e}")
        else:
            print(f"Skipping {filename}, already exists.")

if __name__ == "__main__":
    download_datasets()
