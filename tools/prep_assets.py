"""One-time/occasional: regenerate assets/ from the original Love2D project.
Needs Pillow + ffmpeg and the original source folder:  BOOZE_SRC=/path/to/booze-elroy python3 tools/prep_assets.py
Not needed for normal builds - assets/ is committed."""
import glob, io, os, re, subprocess, sys
from PIL import Image
SRC = os.environ.get("BOOZE_SRC") or sys.exit("set BOOZE_SRC to the original booze-elroy folder")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); A = f"{ROOT}/assets"
def opt(path, out):
    Image.open(path).convert("RGBA").save(out, "PNG", optimize=True)
for n in ("spr16", "spr8", "text8"): opt(f"{SRC}/sprites/{n}.png", f"{A}/sprites/{n}.png")
opt(f"{SRC}/images/boozebanner.png", f"{A}/images/banner.png")
want = set(re.findall(r'"(\w+)"', re.search(r"BACKGROUND_OPTIONS = \[(.*?)\]", open(f"{ROOT}/src/core.js").read(), re.S).group(1)))
for f in sorted(glob.glob(f"{SRC}/backgrounds/*.jpg")):
    n = os.path.basename(f)[:-4]
    if n in ("newyear", "xmas", "pac1", "pac2", "pac3") and n not in want: continue
    im = Image.open(f).convert("RGB").resize((224, 288), Image.LANCZOS).point(lambda v: int(v * 0.25 + 0.5))  # darkened for the CRT look
    im.save(f"{A}/backgrounds/{n}.jpg", "JPEG", quality=82, optimize=True)
for f in sorted(glob.glob(f"{SRC}/sounds/*.wav")):
    n = os.path.basename(f)[:-4]
    if n == "phase-orig": continue
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f, "-ac", "1", "-ar", "22050", "-compression_level", "12", f"{A}/sounds/{n}.flac"], check=True)
print("assets regenerated (data.json comes from tools/export_data.py)")
