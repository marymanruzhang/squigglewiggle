import os
import glob
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models
import json

DATA_DIR = "quickdraw_data"

CATEGORIES = ["aircraft carrier", "airplane", "alarm clock", "ambulance", "angel", "animal migration", "ant", "anvil", "apple", "arm", "asparagus", "axe", "backpack", "banana", "bandage", "barn", "baseball", "baseball bat", "basket", "basketball", "bat", "bathtub", "beach", "bear", "beard", "bed", "bee", "belt", "bench", "bicycle", "binoculars", "bird", "birthday cake", "blackberry", "blueberry", "book", "boomerang", "bottlecap", "bowtie", "bracelet", "brain", "bread", "bridge", "broccoli", "broom", "bucket", "bulldozer", "bus", "bush", "butterfly", "cactus", "cake", "calculator", "calendar", "camel", "camera", "camouflage", "campfire", "candle", "cannon", "canoe", "car", "carrot", "castle", "cat", "ceiling fan", "cello", "cell phone", "chair", "chandelier", "church", "circle", "clarinet", "clock", "cloud", "coffee cup", "compass", "computer", "cookie", "cooler", "couch", "cow", "crab", "crayon", "crocodile", "crown", "cruise ship", "cup", "diamond", "dishwasher", "diving board", "dog", "dolphin", "donut", "door", "dragon", "dresser", "drill", "drums", "duck", "dumbbell", "ear", "elbow", "elephant", "envelope", "eraser", "eye", "eyeglasses", "face", "fan", "feather", "fence", "finger", "fire hydrant", "fireplace", "firetruck", "fish", "flamingo", "flashlight", "flip flops", "floor lamp", "flower", "flying saucer", "foot", "fork", "frog", "frying pan", "garden", "garden hose", "giraffe", "goatee", "golf club", "grapes", "grass", "guitar", "hamburger", "hammer", "hand", "harp", "hat", "headphones", "hedgehog", "helicopter", "helmet", "hexagon", "hockey puck", "hockey stick", "horse", "hospital", "hot air balloon", "hot dog", "hot tub", "hourglass", "house", "house plant", "hurricane", "ice cream", "jacket", "jail", "kangaroo", "key", "keyboard", "knee", "knife", "ladder", "lantern", "laptop", "leaf", "leg", "light bulb", "lighter", "lighthouse", "lightning", "line", "lion", "lipstick", "lobster", "lollipop", "mailbox", "map", "marker", "matches", "megaphone", "mermaid", "microphone", "microwave", "monkey", "moon", "mosquito", "motorbike", "mountain", "mouse", "moustache", "mouth", "mug", "mushroom", "nail", "necklace", "nose", "ocean", "octagon", "octopus", "onion", "oven", "owl", "paintbrush", "paint can", "palm tree", "panda", "pants", "paper clip", "parachute", "parrot", "passport", "peanut", "pear", "peas", "pencil", "penguin", "piano", "pickup truck", "picture frame", "pig", "pillow", "pineapple", "pizza", "pliers", "police car", "pond", "pool", "popsicle", "postcard", "potato", "power outlet", "purse", "rabbit", "raccoon", "radio", "rain", "rainbow", "rake", "remote control", "rhinoceros", "rifle", "river", "roller coaster", "rollerskates", "sailboat", "sandwich", "saw", "saxophone", "school bus", "scissors", "scorpion", "screwdriver", "sea turtle", "see saw", "shark", "sheep", "shoe", "shorts", "shovel", "sink", "skateboard", "skull", "skyscraper", "sleeping bag", "smiley face", "snail", "snake", "snorkel", "snowflake", "snowman", "soccer ball", "sock", "speedboat", "spider", "spoon", "spreadsheet", "square", "squiggle", "squirrel", "stairs", "star", "steak", "stereo", "stethoscope", "stitches", "stop sign", "stove", "strawberry", "streetlight", "string bean", "submarine", "suitcase", "sun", "swan", "sweater", "swing set", "sword", "syringe", "table", "teapot", "teddy-bear", "telephone", "television", "tennis racquet", "tent", "The Eiffel Tower", "The Great Wall of China", "The Mona Lisa", "tiger", "toaster", "toe", "toilet", "tooth", "toothbrush", "toothpaste", "tornado", "tractor", "traffic light", "train", "tree", "triangle", "trombone", "truck", "trumpet", "t-shirt", "umbrella", "underwear", "van", "vase", "violin", "washing machine", "watermelon", "waterslide", "whale", "wheel", "windmill", "wine bottle", "wine glass", "wristwatch", "yoga", "zebra", "zigzag"]

# Reduce samples per class so 345 classes fit in RAM (increase on machines with more RAM)
NUM_SAMPLES_PER_CLASS = 2000
IMG_SIZE = (28, 28)
LABEL_SMOOTHING = 0.05

def load_data():
    X = []
    y = []
    
    unique_labels = sorted(CATEGORIES)
    label_to_id = {label: idx for idx, label in enumerate(unique_labels)}
    
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.npy'):
            continue
            
        base_cat = filename.replace('.npy', '')
        if base_cat not in label_to_id:
            continue
            
        label_id = label_to_id[base_cat]
        filepath = os.path.join(DATA_DIR, filename)
        
        data = np.load(filepath)
        print(f"Loaded {filename} with shape {data.shape}")
        
        data = data[:NUM_SAMPLES_PER_CLASS]
        data = data.astype('float32') / 255.0
        data = data.reshape(-1, 28, 28, 1)
        
        X.append(data)
        y.extend([label_id] * len(data))
        
    if len(X) == 0:
        return np.array([]), np.array([]), unique_labels
        
    X = np.concatenate(X, axis=0)
    y = np.array(y)
    
    print(f"\nFinal dataset shape: {X.shape}")
    print(f"Classes: {len(unique_labels)}")
    
    return X, y, unique_labels

def build_model(num_classes):
    model = models.Sequential([
        layers.Input(shape=(28, 28, 1)),
        layers.RandomTranslation(0.1, 0.1),
        layers.RandomRotation(0.12),
        layers.RandomZoom(0.15),
        layers.GaussianNoise(0.03),
        layers.Conv2D(32, (3, 3), padding='same', use_bias=False),
        layers.BatchNormalization(),
        layers.Activation("relu"),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(64, (3, 3), padding='same', use_bias=False),
        layers.BatchNormalization(),
        layers.Activation("relu"),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(128, (3, 3), padding='same', use_bias=False),
        layers.BatchNormalization(),
        layers.Activation("relu"),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(256, (3, 3), padding='same', use_bias=False),
        layers.BatchNormalization(),
        layers.Activation("relu"),
        layers.GlobalAveragePooling2D(),
        layers.Dense(512, activation="relu"),
        layers.Dropout(0.4),
        layers.Dense(num_classes, activation="softmax"),
    ])
    opt = tf.keras.optimizers.Adam(learning_rate=1.5e-3, clipnorm=1.0)
    loss = tf.keras.losses.SparseCategoricalCrossentropy(label_smoothing=LABEL_SMOOTHING)
    model.compile(optimizer=opt, loss=loss, metrics=['accuracy'])
    return model

if __name__ == '__main__':
    X, y, classes = load_data()
    
    idx_to_class = {idx: label for idx, label in enumerate(classes)}
    with open('class_indices.json', 'w') as f:
        json.dump(idx_to_class, f)
        
    if len(X) == 0:
        print("No valid data found. Run download_quickdraw.py first.")
        exit(1)
        
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    X = X[indices]
    y = y[indices]
    
    model = build_model(len(classes))
    model.summary()
    
    print("Training QuickDraw-based sketch model...")
    es = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=4, restore_best_weights=True, min_delta=1e-4
    )
    model.fit(
        X,
        y,
        epochs=25,
        batch_size=128,
        validation_split=0.1,
        callbacks=[es],
        verbose=1,
    )
    
    model.save('sketch_model.keras')
    print("Training complete. Saved to sketch_model.keras")
