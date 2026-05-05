import sys
import os
import json
from PIL import Image, ImageSequence, ImageOps

def crop_image(source_path, dest_path, crop_data):
    try:
        with Image.open(source_path) as img:
            x = round(crop_data['x'])
            y = round(crop_data['y'])
            w = round(crop_data['width'])
            h = round(crop_data['height'])
            rot = crop_data['rotation']
            flip_h = crop_data['flip_h']
            flip_v = crop_data['flip_v']

            if img.format == 'GIF' and getattr(img, "is_animated", False):
                frames = []
                for frame in ImageSequence.Iterator(img):
                    # Copy and transform frame
                    f = frame.copy()
                    
                    # Apply rotation
                    if rot != 0:
                        f = f.rotate(-rot, expand=True) # PIL uses counter-clockwise
                    
                    # Apply flips
                    if flip_h:
                        f = ImageOps.mirror(f)
                    if flip_v:
                        f = ImageOps.flip(f)
                    
                    # Apply crop
                    # Note: after rotation, we need to recalculate or just crop from the center
                    # But since we get the coordinates from the UI which already accounts for rotation
                    # we just apply the box [x, y, x+w, y+h]
                    f = f.crop((x, y, x + w, y + h))
                    frames.append(f)
                
                # Save as animated GIF
                frames[0].save(
                    dest_path,
                    save_all=True,
                    append_images=frames[1:],
                    optimize=True,
                    duration=img.info.get('duration', 100),
                    loop=img.info.get('loop', 0),
                    disposal=2 # Clear frame
                )
            else:
                # Static image
                if rot != 0:
                    img = img.rotate(-rot, expand=True)
                if flip_h:
                    img = ImageOps.mirror(img)
                if flip_v:
                    img = ImageOps.flip(img)
                
                img = img.crop((x, y, x + w, y + h))
                ext = os.path.splitext(dest_path)[1].lower()

                if ext in (".jpg", ".jpeg"):
                    if img.mode in ("RGBA", "P", "LA"):
                        img = img.convert("RGB")
                    img.save(dest_path, "JPEG", quality=95)
                elif ext == ".png":
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    img.save(dest_path, "PNG", optimize=True)
                elif ext == ".gif":
                    if img.mode not in ("P", "L"):
                        img = img.convert("P", palette=Image.ADAPTIVE)
                    img.save(dest_path, "GIF", optimize=True)
                else:
                    img.save(dest_path)
            
            return True
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        return False

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python image_processor.py <source> <dest> <crop_json>")
        sys.exit(1)
    
    source = sys.argv[1]
    dest = sys.argv[2]
    try:
        crop_data = json.loads(sys.argv[3])
        if crop_image(source, dest, crop_data):
            sys.exit(0)
        else:
            sys.exit(1)
    except Exception as e:
        print(f"Failed: {str(e)}", file=sys.stderr)
        sys.exit(1)
