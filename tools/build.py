"""Bundle src/ + assets/ into one self-contained page: public/index.html.  Needs Python 3 and Node (esbuild via npx)."""
import base64, glob, json, os, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); A = f"{ROOT}/assets"
b64 = lambda b: base64.b64encode(b).decode()
rd = lambda p: open(p, "rb").read()
uri = lambda b, mime: f"data:{mime};base64," + b64(b)
stem = lambda f: os.path.splitext(os.path.basename(f))[0]
assets = {
    "video": uri(rd(f"{A}/video/mina.mp4"), "video/mp4"),
    "videoWebm": uri(rd(f"{A}/video/mina.webm"), "video/webm"),
    "data": json.load(open(f"{A}/data.json")),
    "images": {**{stem(f): uri(rd(f), "image/png") for f in sorted(glob.glob(f"{A}/sprites/*.png"))},
               **{stem(f): uri(rd(f), "image/png") for f in sorted(glob.glob(f"{A}/images/*.png"))}},
    "sounds": {stem(f): b64(rd(f)) for f in sorted(glob.glob(f"{A}/sounds/*.flac") + glob.glob(f"{A}/sounds/*.mp3"))},
    "backgrounds": {stem(f): uri(rd(f), "image/jpeg") for f in sorted(glob.glob(f"{A}/backgrounds/*.jpg"))},
}
os.makedirs(f"{ROOT}/build", exist_ok=True); os.makedirs(f"{ROOT}/public", exist_ok=True)
open(f"{ROOT}/build/bundle.js", "w").write("\n".join(open(f"{ROOT}/src/{n}.js").read() for n in ("core", "scorekey", "leaderboard", "audio", "render", "main")))
subprocess.run(["npx", "--yes", "esbuild@0.25.0", f"{ROOT}/build/bundle.js", "--minify", f"--outfile={ROOT}/build/bundle.min.js"], check=True, capture_output=True)
code = open(f"{ROOT}/build/bundle.min.js").read().replace("</script", "<\\/script")
html = open(f"{ROOT}/template/index.html").read().replace("/*ASSETS*/", json.dumps(assets, separators=(",", ":")), 1).replace("/*CODE*/", code, 1)
open(f"{ROOT}/public/index.html", "w").write(html)
print(f"public/index.html  {len(html)//1024} KB")
