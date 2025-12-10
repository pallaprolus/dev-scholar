import os
import sys
import subprocess

def install_pillow():
    try:
        import PIL
        print("Pillow is already installed.")
    except ImportError:
        print("Pillow not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
        print("Pillow installed.")

install_pillow()

from PIL import Image

# Configuration
ICON_SOURCE = "/Users/sudhakarpallaprolu/.gemini/antigravity/brain/ccc95549-4a25-4e51-9f4e-048bdf4b3151/uploaded_image_0_1765407265464.jpg"
BANNER_SOURCE = "/Users/sudhakarpallaprolu/.gemini/antigravity/brain/ccc95549-4a25-4e51-9f4e-048bdf4b3151/uploaded_image_1_1765407265464.jpg"

OUTPUT_DIR = "images"
ICON_OUTPUT = os.path.join(OUTPUT_DIR, "icon.png")
BANNER_OUTPUT = os.path.join(OUTPUT_DIR, "banner.png")

def process_icon():
    print(f"Processing Icon from {ICON_SOURCE}...")
    try:
        img = Image.open(ICON_SOURCE)
        img = img.resize((128, 128), Image.Resampling.LANCZOS)
        img.save(ICON_OUTPUT, "PNG")
        print(f"Icon saved to {ICON_OUTPUT}")
    except Exception as e:
        print(f"Error processing icon: {e}")

def process_banner():
    print(f"Processing Banner from {BANNER_SOURCE}...")
    try:
        img = Image.open(BANNER_SOURCE)
        
        # Target dimensions
        target_w, target_h = 1200, 640
        
        # Calculate aspect ratios
        img_ratio = img.width / img.height
        target_ratio = target_w / target_h
        
        if img_ratio > target_ratio:
            # Image is wider than target
            new_height = target_h
            new_width = int(new_height * img_ratio)
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # Crop center
            left = (new_width - target_w) / 2
            top = 0
            right = (new_width + target_w) / 2
            bottom = target_h
            
            cropped = resized.crop((left, top, right, bottom))
        else:
            # Image is taller than target
            new_width = target_w
            new_height = int(new_width / img_ratio)
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # Crop center
            left = 0
            top = (new_height - target_h) / 2
            right = target_w
            bottom = (new_height + target_h) / 2
            
            cropped = resized.crop((left, top, right, bottom))
            
        cropped.save(BANNER_OUTPUT, "PNG")
        print(f"Banner saved to {BANNER_OUTPUT}")
    except Exception as e:
        print(f"Error processing banner: {e}")

if __name__ == "__main__":
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        
    process_icon()
    process_banner()
