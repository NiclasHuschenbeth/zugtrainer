"""Erzeugt die Dateiliste und Versionsnummer für den Service Worker."""
import io, os, sys, json, base64, re, hashlib

root = sys.argv[1]

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
