import math
from PIL import Image, ImageDraw, ImageFont

def create_gradient_fill(width, height, start_color, end_color):
    base = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for y in range(height):
        ratio = y / max(height - 1, 1)
        r = int(start_color[0] * (1 - ratio) + end_color[0] * ratio)
        g = int(start_color[1] * (1 - ratio) + end_color[1] * ratio)
        b = int(start_color[2] * (1 - ratio) + end_color[2] * ratio)
        for x in range(width):
            base.putpixel((x, y), (r, g, b, 255))
    return base

def generate_logo():
    size = 512
    img = Image.new('RGBA', (size, size), (9, 13, 22, 255))
    draw = ImageDraw.Draw(img)

    # Ambient radial glow in center
    cx, cy = size // 2, size // 2
    for r in range(220, 0, -2):
        alpha = int(28 * (1 - r / 220))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(124, 58, 237, alpha))

    # Outer fine radar rings
    for r in [230, 180, 130]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(37, 99, 235, 40), width=1)

    # Draw the 3 pillars representing Demand, Commercial, Window
    # Pillar 1 (Left, shorter)
    draw.polygon([(110, 390), (110, 270), (195, 225), (195, 345)], fill=(124, 58, 237, 240))
    # Pillar 2 (Middle, taller)
    draw.polygon([(215, 390), (215, 175), (320, 120), (320, 335)], fill=(37, 99, 235, 245))
    # Pillar 3 (Right, angled peak)
    draw.polygon([(340, 340), (340, 110), (410, 75), (410, 240)], fill=(6, 182, 212, 250))
    draw.polygon([(410, 75), (410, 240), (430, 230), (430, 95)], fill=(52, 211, 153, 255))

    # Highlights
    draw.line([(110, 270), (195, 225)], fill=(167, 139, 250, 255), width=3)
    draw.line([(215, 175), (320, 120)], fill=(96, 165, 250, 255), width=3)
    draw.line([(340, 110), (410, 75)], fill=(110, 231, 183, 255), width=3)

    img.save('apps/web/public/logo.png', 'PNG')
    print('Generated apps/web/public/logo.png (512x512)')

def generate_og_image():
    w, h = 1200, 630
    img = Image.new('RGB', (w, h), (9, 13, 22))
    draw = ImageDraw.Draw(img)

    # Ambient corner glow
    for r in range(400, 0, -4):
        alpha = int(22 * (1 - r / 400))
        # Top-right glow (cyan)
        draw.ellipse([900 - r, 100 - r, 900 + r, 100 + r], fill=(6, 182, 212, alpha))
        # Bottom-left glow (violet)
        draw.ellipse([200 - r, 500 - r, 200 + r, 500 + r], fill=(124, 58, 237, alpha))

    # Grid lines (subtle telemetry grid)
    for x in range(0, w, 80):
        draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 6), width=1)
    for y in range(0, h, 70):
        draw.line([(0, y), (w, y)], fill=(255, 255, 255, 6), width=1)

    # Load fonts
    font_path_bold = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
    font_path_reg = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'

    try:
        font_brand = ImageFont.truetype(font_path_bold, 36)
        font_eyebrow = ImageFont.truetype(font_path_bold, 18)
        font_title = ImageFont.truetype(font_path_bold, 54)
        font_sub = ImageFont.truetype(font_path_reg, 24)
        font_pill = ImageFont.truetype(font_path_bold, 18)
        font_meta = ImageFont.truetype(font_path_reg, 16)
    except Exception:
        font_brand = ImageFont.load_default()
        font_eyebrow = font_brand
        font_title = font_brand
        font_sub = font_brand
        font_pill = font_brand
        font_meta = font_brand

    # Draw Brand Logo Icon on left
    ix, iy = 90, 80
    # 3 small pillars
    draw.polygon([(ix + 0, iy + 45), (ix + 0, iy + 25), (ix + 18, iy + 15), (ix + 18, iy + 38)], fill=(124, 58, 237))
    draw.polygon([(ix + 22, iy + 45), (ix + 22, iy + 10), (ix + 42, iy + 0), (ix + 42, iy + 35)], fill=(37, 99, 235))
    draw.polygon([(ix + 46, iy + 40), (ix + 46, iy + 5), (ix + 64, iy + 0), (ix + 64, iy + 28)], fill=(6, 182, 212))

    # Wordmark
    draw.text((ix + 80, iy + 5), "EMERADAR", font=font_brand, fill=(245, 247, 250))

    # Eyebrow badge
    draw.rectangle([(90, 160), (450, 196)], fill=(15, 23, 42), outline=(37, 99, 235))
    draw.text((105, 168), "SEARCH SIGNAL INTELLIGENCE · US-EN", font=font_eyebrow, fill=(96, 165, 250))

    # Main Headline
    draw.text((90, 220), "Validate Micro-SaaS Demand\nBefore Writing Any Code.", font=font_title, fill=(255, 255, 255), spacing=12)

    # Subhead description
    subhead_text = "Continuously audits search demand growth, commercial pricing proof, and\nSERP vulnerability across Google and search engines with verifiable outcomes."
    draw.text((90, 365), subhead_text, font=font_sub, fill=(160, 174, 192), spacing=8)

    # 3 Axis cards at bottom
    axes = [
        ("AXIS D", "Demand Formation", (124, 58, 237), (167, 139, 250)),
        ("AXIS M", "Willingness to Pay", (37, 99, 235), (96, 165, 250)),
        ("AXIS W", "Competitor Window", (6, 182, 212), (110, 231, 183)),
    ]

    card_x = 90
    card_y = 480
    card_w = 320
    card_h = 76

    for code, label, border_color, text_color in axes:
        # Card background
        draw.rectangle([(card_x, card_y), (card_x + card_w, card_y + card_h)], fill=(17, 24, 39), outline=border_color, width=1)
        draw.text((card_x + 18, card_y + 16), code, font=font_pill, fill=text_color)
        draw.text((card_x + 18, card_y + 42), label, font=font_meta, fill=(203, 213, 225))
        card_x += card_w + 30

    # Right-side decorative telemetry graph
    gx = 880
    gy = 200
    gw = 230
    gh = 160
    draw.rectangle([(gx, gy), (gx + gw, gy + gh)], fill=(15, 23, 42), outline=(51, 65, 85))
    draw.text((gx + 16, gy + 14), "RADAR TELEMETRY", font=font_meta, fill=(148, 163, 184))
    # Simulated chart line
    points = [(gx + 20, gy + 120), (gx + 60, gy + 100), (gx + 100, gy + 110), (gx + 140, gy + 65), (gx + 180, gy + 50), (gx + 210, gy + 35)]
    for i in range(len(points) - 1):
        draw.line([points[i], points[i+1]], fill=(52, 211, 153), width=2)
        draw.ellipse([points[i][0]-3, points[i][1]-3, points[i][0]+3, points[i][1]+3], fill=(52, 211, 153))
    draw.ellipse([points[-1][0]-4, points[-1][1]-4, points[-1][0]+4, points[-1][1]+4], fill=(52, 211, 153))

    img.save('apps/web/public/og-image.png', 'PNG')
    print('Generated apps/web/public/og-image.png (1200x630)')

if __name__ == '__main__':
    generate_logo()
    generate_og_image()
