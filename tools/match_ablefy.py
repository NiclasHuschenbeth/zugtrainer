"""Ordnet PGN-Kapitel den Ablefy-Lektionen zu (Reihenfolge + Namensähnlichkeit).

Erzeugt aus der Lektionsliste (ablefy-lektionen.json: [{cat, lesson, id}], im Kundenbereich ausgelesen):
  - eine PGN-Kopie mit den Headern [Lesson] (= Modul der Lektion) und [Priority "1"] (= "(P)" im Lektionstitel),
  - eine JSON-Datei mit Videolinks { "<Kapitelname>": "<Link>" } (Kapitelname = "White – Black" der PGN).
Die Original-PGN wird nie verändert.

Aufruf:
  python match_ablefy.py <lektionen.json> <kurs-slug> <ausgabeordner> <name1=eingabe1.pgn> [<name2=eingabe2.pgn> ...] [fix=<korrekturen.json>]
  korrekturen.json: { "<Kapitelname oder Anfang davon>": <Lektions-ID> } überschreibt die automatische Zuordnung.
Beispiel: python match_ablefy.py lektionen.json bulletproof-repertoire-russisch-83f1ef60 out Basis=basis.pgn Fortgeschritten=fort.pgn
Ausgabe: <ausgabeordner>/<name>.pgn und <ausgabeordner>/videos.json (alle Kapitelnamen, beide PGNs zusammen).
Zuordnungen mit geringer Ähnlichkeit werden zur Kontrolle ausgegeben.
"""
import difflib
import io
import json
import re
import sys

BASE = 'https://shop.modernchess.de/payer/s/modernchess/courses/{slug}?lesson_id={id}'
SKIP = re.compile(r'schl[üu]sselstellungen|quiz|^einf[üu]hrung|übersicht|zum download|hochladen|meiste aus dem kurs|tipps zum lernen', re.I)


def norm(s):
    s = s.lower()
    s = re.sub(r'\(p\)', ' ', s)
    s = re.sub(r'\(alternative empfehlung\)', ' ', s)
    s = re.sub(r'\bnv\b', 'nebenvarianten', s)
    s = re.sub(r'\bhv\b', 'hauptvariante', s)
    s = s.replace('qc2', 'dc2')
    s = re.sub(r'[–\-:,;]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def sim(a, b):
    ta, tb = norm(a).split(), norm(b).split()
    if not ta or not tb:
        return 0.0
    sm = difflib.SequenceMatcher(None, ta, tb).ratio()
    cs = difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()
    return 0.5 * sm + 0.5 * cs


def chapters_of(pgn):
    games = re.split(r'\n\n(?=\[Event )', pgn)
    names = []
    for g in games:
        w = re.search(r'\[White "([^"]*)"', g)
        b = re.search(r'\[Black "([^"]*)"', g)
        names.append(f'{w.group(1)} – {b.group(1)}' if w and b else '')
    return games, names


def align(chs, les, min_score=0.45):
    """Monotone Zuordnung (Dynamische Programmierung): Kapitel i -> Lektion j, Reihenfolge bleibt erhalten."""
    n, m = len(chs), len(les)
    S = [[sim(c, l['lesson']) for l in les] for c in chs]
    best = [[0.0] * (m + 1) for _ in range(n + 1)]
    arrow = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            opts = [(best[i - 1][j], 'c'), (best[i][j - 1], 'l')]
            if S[i - 1][j - 1] >= min_score:
                opts.append((best[i - 1][j - 1] + S[i - 1][j - 1], 'm'))
            best[i][j], arrow[i][j] = max(opts, key=lambda o: o[0])
    out = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        a = arrow[i][j]
        if a == 'm':
            out[i - 1] = (j - 1, S[i - 1][j - 1])
            i, j = i - 1, j - 1
        elif a == 'c':
            i -= 1
        else:
            j -= 1
    return out


def main(lessons_file, slug, outdir, *specs):
    lessons = json.load(io.open(lessons_file, encoding='utf-8'))
    les = [l for l in lessons if not SKIP.search(l['lesson'])]
    byid_all = {str(l['id']): l for l in lessons}  # Korrekturen dürfen auch ausgeblendete Lektionen (z. B. "Einführung") wählen
    videos = {}
    fixes = {}
    for spec in specs:
        if spec.startswith('fix='):
            fixes = json.load(io.open(spec[4:], encoding='utf-8'))
    for spec in specs:
        if spec.startswith('fix='):
            continue
        label, path = spec.split('=', 1)
        pgn = io.open(path, encoding='utf-8-sig').read()
        games, names = chapters_of(pgn)
        al = align(names, les)
        fixed = {}
        for key, lid in fixes.items():
            if key.startswith('#'):  # "#24": Kapitelnummer (1-basiert), z. B. wenn zwei Kapitel gleich heißen
                if int(key[1:]) - 1 < len(names):
                    fixed[int(key[1:]) - 1] = byid_all[str(lid)]
                continue
            exact = [k for k, nm in enumerate(names) if nm == key]
            for k in exact or [k for k, nm in enumerate(names) if nm.startswith(key)]:  # erst exakt, sonst Anfang des Namens
                fixed[k] = byid_all[str(lid)]
        used = {a[0] for k, a in enumerate(al) if a is not None and k not in fixed} | {les.index(l) for l in fixed.values() if l in les}
        unused = [l['lesson'][:75] for i, l in enumerate(les) if i not in used]
        print(f'   unbenutzte Lektionen: {unused}')
        out, last_cat = [], les[0]['cat']
        print(f'== {label}: {len(games)} Kapitel, {sum(a is not None for a in al)} zugeordnet')
        for k, (g, nm, a) in enumerate(zip(games, names, al), 1):
            extra = ''
            if k - 1 in fixed:
                l = fixed[k - 1]
                last_cat = l['cat']
                videos.setdefault(nm, BASE.format(slug=slug, id=l['id']))
                extra_p = '[Priority "1"]\n' if '(P)' in l['lesson'] else ''
            elif a is not None:
                l = les[a[0]]
                last_cat = l['cat']
                videos.setdefault(nm, BASE.format(slug=slug, id=l['id']))
                if '(P)' in l['lesson']:
                    extra_p = '[Priority "1"]\n'
                else:
                    extra_p = ''
                if a[1] < 0.8:
                    print(f'   ? {k:2} {nm[:70]!r} -> {l["lesson"][:70]!r} ({a[1]:.2f})')
            else:
                extra_p = ''
                print(f'   - {k:2} {nm[:80]!r} ohne Lektion (Modul von davor: {last_cat[:40]!r})')
            extra = f'[Lesson "{last_cat}"]\n' + extra_p
            lines = g.split('\n')
            blank = next(i for i, ln in enumerate(lines) if not ln.strip())
            lines.insert(blank, extra.rstrip('\n'))
            out.append('\n'.join(lines))
        io.open(f'{outdir}/{label}.pgn', 'w', encoding='utf-8', newline='\n').write('\n\n'.join(out))
    io.open(f'{outdir}/videos.json', 'w', encoding='utf-8').write(json.dumps(videos, ensure_ascii=False, indent=1))
    print(len(videos), 'Videolinks')


if __name__ == '__main__':
    main(*sys.argv[1:])
