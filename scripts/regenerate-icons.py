"""
Remove the blue background from the app icon and regenerate all Tauri icon sizes.
The icon content (monitor + gear) is kept on a transparent background.
"""

import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).parent.parent
ICONS_DIR = ROOT / "src-tauri" / "icons"
SOURCE = ROOT / "app-icon.png"

BG_COLOR = np.array([30, 60, 140], dtype=float)
THRESHOLD = 35  # pixels within this distance of bg color are considered background


def remove_background(img: Image.Image) -> Image.Image:
    """Remove the blue background from the app icon.

    The original icon is a monitor+gear rendered on a solid blue (30,60,140)
    rounded rectangle. The background color only appears in the background —
    not in any icon element — so we can safely remove all pixels matching it.

    Semi-transparent pixels (alpha < 200) in the original are anti-aliased
    edges of the rounded rectangle, which should also be removed.
    """
    arr = np.array(img.convert("RGBA"), dtype=np.float64)

    # Calculate color distance from background for each pixel
    rgb = arr[:, :, :3]
    dist = np.sqrt(np.sum((rgb - BG_COLOR) ** 2, axis=2))

    # Remove pixels that match the background color
    is_bg = dist < THRESHOLD
    arr[is_bg, 3] = 0

    # Remove semi-transparent pixels — these are anti-aliased edges of the
    # rounded rectangle background, not part of the icon content (which is
    # fully opaque on top of the opaque blue background)
    is_semi = arr[:, :, 3] < 200
    arr[is_semi, 3] = 0

    return Image.fromarray(arr.astype(np.uint8))


def crop_to_content(img: Image.Image, padding_pct: float = 0.08) -> Image.Image:
    """Crop to content bounding box, add padding, and make square."""
    arr = np.array(img)

    # Find non-transparent pixels
    content = arr[:, :, 3] > 10
    rows = np.any(content, axis=1)
    cols = np.any(content, axis=0)

    if not np.any(rows) or not np.any(cols):
        return img

    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    # Crop to content
    cropped = img.crop((cmin, rmin, cmax + 1, rmax + 1))
    cw, ch = cropped.size

    # Make square (use the larger dimension)
    size = max(cw, ch)

    # Add padding
    padding = int(size * padding_pct)
    total_size = size + 2 * padding

    # Center content in square canvas
    square = Image.new("RGBA", (total_size, total_size), (0, 0, 0, 0))
    x_offset = (total_size - cw) // 2
    y_offset = (total_size - ch) // 2
    square.paste(cropped, (x_offset, y_offset))

    return square


def create_ico(images: dict[int, Image.Image], output_path: Path):
    """Create a proper .ico file with multiple sizes."""
    # ICO sizes to include (Windows standard)
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]

    # Generate any missing sizes from the largest available
    largest = max(images.keys())
    source = images[largest]

    ico_images = []
    for size in ico_sizes:
        if size in images:
            ico_images.append(images[size].copy())
        else:
            ico_images.append(
                source.copy().resize((size, size), Image.LANCZOS)
            )

    # Use Pillow's built-in ICO saving
    ico_images[0].save(
        str(output_path),
        format="ICO",
        sizes=[(img.size[0], img.size[1]) for img in ico_images],
        append_images=ico_images[1:],
    )


def main():
    print(f"Loading source icon: {SOURCE}")
    original = Image.open(str(SOURCE)).convert("RGBA")
    print(f"  Size: {original.size}, Mode: {original.mode}")

    print("Removing blue background...")
    no_bg = remove_background(original)

    print("Cropping to content and making square...")
    icon = crop_to_content(no_bg, padding_pct=0.06)
    print(f"  Result size: {icon.size}")

    # Save the new source icon
    icon.save(str(SOURCE))
    print(f"Saved: {SOURCE}")

    # Generate all required sizes
    sizes = {
        "icon.png": 512,  # main icon
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        # Windows Store logos
        "StoreLogo.png": 50,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }

    generated_images: dict[int, Image.Image] = {}

    for filename, size in sizes.items():
        resized = icon.resize((size, size), Image.LANCZOS)
        output = ICONS_DIR / filename
        resized.save(str(output))
        generated_images[size] = resized
        print(f"  Generated: {filename} ({size}x{size})")

    # Generate ICO
    print("Generating icon.ico...")
    create_ico(generated_images | {512: icon}, ICONS_DIR / "icon.ico")
    print(f"  Generated: icon.ico")

    # Generate ICNS (macOS) - Pillow can save ICNS
    print("Generating icon.icns...")
    try:
        icns_sizes = [16, 32, 64, 128, 256, 512]
        icns_images = []
        for size in icns_sizes:
            if size in generated_images:
                icns_images.append(generated_images[size])
            else:
                icns_images.append(icon.resize((size, size), Image.LANCZOS))

        icns_images[0].save(
            str(ICONS_DIR / "icon.icns"),
            format="ICNS",
            append_images=icns_images[1:],
        )
        print(f"  Generated: icon.icns")
    except Exception as e:
        print(f"  Warning: Could not generate ICNS: {e}")
        # Fallback: save a 512x512 PNG as icns placeholder
        icon.resize((512, 512), Image.LANCZOS).save(
            str(ICONS_DIR / "icon.icns"), format="PNG"
        )
        print(f"  Saved PNG fallback as icon.icns")

    # iOS icons
    ios_dir = ICONS_DIR / "ios"
    ios_sizes = {
        "AppIcon-20x20@1x.png": 20,
        "AppIcon-20x20@2x.png": 40,
        "AppIcon-20x20@2x-1.png": 40,
        "AppIcon-20x20@3x.png": 60,
        "AppIcon-29x29@1x.png": 29,
        "AppIcon-29x29@2x.png": 58,
        "AppIcon-29x29@2x-1.png": 58,
        "AppIcon-29x29@3x.png": 87,
        "AppIcon-40x40@1x.png": 40,
        "AppIcon-40x40@2x.png": 80,
        "AppIcon-40x40@2x-1.png": 80,
        "AppIcon-40x40@3x.png": 120,
        "AppIcon-60x60@2x.png": 120,
        "AppIcon-60x60@3x.png": 180,
        "AppIcon-76x76@1x.png": 76,
        "AppIcon-76x76@2x.png": 152,
        "AppIcon-83.5x83.5@2x.png": 167,
        "AppIcon-512@2x.png": 1024,
    }
    if ios_dir.exists():
        for filename, size in ios_sizes.items():
            resized = icon.resize((size, size), Image.LANCZOS)
            resized.save(str(ios_dir / filename))
        print(f"  Generated {len(ios_sizes)} iOS icons")

    # Android icons
    android_dir = ICONS_DIR / "android"
    android_sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    if android_dir.exists():
        for folder, size in android_sizes.items():
            folder_path = android_dir / folder
            if folder_path.exists():
                for name in [
                    "ic_launcher.png",
                    "ic_launcher_round.png",
                    "ic_launcher_foreground.png",
                ]:
                    filepath = folder_path / name
                    if filepath.exists():
                        resized = icon.resize((size, size), Image.LANCZOS)
                        resized.save(str(filepath))
        print(f"  Generated Android icons")

    print("\nDone! All icons regenerated with transparent background.")


if __name__ == "__main__":
    main()
