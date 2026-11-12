"""Erzeugt App-Symbole und die Dateiliste für den Service Worker."""
import io, os, sys, json, base64, re, hashlib
from PIL import Image, ImageDraw

root = sys.argv[1]
os.makedirs(root + '/icons', exist_ok=True)

# Springer aus dem cburnett-Figurensatz (liegt in der chessground-CSS als SVG) -> eigenes Symbol
css = io.open(root + '/vendor/chessground/chessground.cburnett.css', encoding='utf-8').read()
m = re.search(r"\.knight\.white\s*\{[^}]*base64,([A-Za-z0-9+/=]+)", css)
knight = base64.b64decode(m.group(1)).decode('utf-8')
inner = re.search(r'<svg[^>]*>(.*)</svg>', knight, re.S).group(1)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
       '<rect width="64" height="64" rx="12" fill="#629924"/>'
       '<g transform="translate(9.5 8) scale(1)">' + inner + '</g></svg>')
io.open(root + '/icons/icon.svg', 'w', encoding='utf-8', newline='\n').write(svg)

# PNG: grünes Feld mit hellem Schachbrett-Akzent (einfach gehalten, ohne SVG-Renderer)
def png(size):
    im = Image.new('RGB', (size, size), '#629924')
    d = ImageDraw.Draw(im)
    pad = size * 0.2
    cell = (size - 2 * pad) / 4
    for r in range(4):
        for c in range(4):
            col = '#f0d9b5' if (r + c) % 2 == 0 else '#b58863'
            d.rectangle([pad + c * cell, pad + r * cell, pad + (c + 1) * cell, pad + (r + 1) * cell], fill=col)
    im.save(root + f'/icons/icon-{size}.png')

for s in (180, 192, 512):
    png(s)

# Dateiliste für den Offline-Speicher
files = []
for base, dirs, names in os.walk(root):
    dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'tools']
    for n in names:
        rel = os.path.relpath(os.path.join(base, n), root).replace('\\', '/')
        if rel in ('sw.js', '_headers', 'README.md', 'UEBERSICHT.md') or rel.endswith(('LICENSE', 'LICENSE.txt', 'Copying.txt', 'LICENSE-htm', 'LICENSE-preact')):
            continue
        if rel.startswith('vendor/chessops/') and rel.split('/')[-1] in ('debug.js', 'index.js'):
            continue
        files.append(rel)
files.sort()
h = hashlib.sha1()
for f in files:
    h.update(open(root + '/' + f, 'rb').read())
version = h.hexdigest()[:10]

sw = io.open(root + '/sw.js', encoding='utf-8').read()
sw = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", sw)
sw = re.sub(r"const FILES = \[[^\]]*\];", "const FILES = " + json.dumps(['./'] + files, indent=2) + ";", sw)
io.open(root + '/sw.js', 'w', encoding='utf-8', newline='\n').write(sw)
print(len(files), 'Dateien, Version', version)
