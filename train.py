import os
import glob
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models
import json

DATA_DIR = "quickdraw_data"

QUICKDRAW_CATEGORY_MAP = {
    "flower": "nature",
    "tree": "nature",
    "sun": "weather_or_sky",
    "cloud": "weather_or_sky",
    "cat": "four_legged_animals",
    "dog": "four_legged_animals",
    "horse": "four_legged_animals",
    "fish": "fish",
    "bird": "bird",
    "hamburger": "food",
    "cupcake": "food",
    "chair": "furniture",
    "table": "furniture"
}

NUM_SAMPLES_PER_CLASS = 15000 
IMG_SIZE = (28, 28)

def load_data():
    X = []
    y = []
    
    unique_labels = sorted(list(set(QUICKDRAW_CATEGORY_MAP.values())))
    label_to_id = {label: idx for idx, label in enumerate(unique_labels)}
    
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.npy'):
            continue
            
        base_cat = filename.replace('.npy', '')
        if base_cat not in QUICKDRAW_CATEGORY_MAP:
            continue
            
        label = QUICKDRAW_CATEGORY_MAP[base_cat]
        label_id = label_to_id[label]
        
        filepath = os.path.join(DATA_DIR, filename)
        
        data = np.load(filepath)
        print(f"Loaded {filename} with shape {data.shape}")
        
        data = data[:NUM_SAMPLES_PER_CLASS]
        
        data = data.astype('float32') / 255.0
        data = data.reshape(-1, 28, 28, 1)
        
        X.append(data)
        y.extend([label_id] * len(data))
        
    X = np.concatenate(X, axis=0)
    y = np.array(y)
    
    print(f"\nFinal dataset shape: {X.shape}")
    print(f"Classes: {unique_labels}")
    
    return X, y, unique_labels

def build_model(num_classes):
    model = models.Sequential([
        layers.Input(shape=(28, 28, 1)),
        layers.RandomTranslation(0.1, 0.1),
        layers.RandomZoom(0.1),
        
        layers.Conv2D(32, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(64, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(128, (3, 3), activation='relu', padding='same'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Flatten(),
        layers.Dense(256, activation='relu'),
        layers.Dropout(0.5),
        layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(optimizer='adam',
                  loss='sparse_categorical_crossentropy',
                  metrics=['accuracy'])
    return model

if __name__ == '__main__':
    X, y, classes = load_data()
    
    idx_to_class = {idx: label for idx, label in enumerate(classes)}
    with open('class_indices.json', 'w') as f:
        json.dump(idx_to_class, f)
        
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    X = X[indices]
    y = y[indices]
    
    model = build_model(len(classes))
    model.summary()
    
    print("Training QuickDraw-based sketch model...")
    model.fit(X, y, epochs=10, batch_size=128, validation_split=0.1)
    
    model.save('sketch_model.keras')
    print("Training complete. Saved to sketch_model.keras")
