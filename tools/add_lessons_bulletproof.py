"""Ergänzt in der Bulletproof-PGN die Header [Lesson] und [Priority].

Lektionen = Ordner/Kapitel des Kurses (Reihenfolge = Reihenfolge der PGN-Kapitel),
Priorität = Videos mit "(P)" auf der Kursseite (Stand 13.11.2026).
Aufruf: python add_lessons_bulletproof.py <eingabe.pgn> <ausgabe.pgn>
Die Originaldatei wird nie verändert.
"""
import io
import re
import sys

LESSONS = [
    ('1.c4 e5 Nebenvarianten im 2. Zug', 4),
    ('1.c4 e5 2.g3', 7),
    ('1.c4 e5 2.Sc3 Lb4 Nebenvarianten', 7),
    ('1.c4 e5 2.Sc3 Lb4 3.Sd5', 6),
    ('1.Sf3 d5 2.b3 & 2.e3', 4),
    ('1.Sf3 d5 2.c4', 3),
    ('1.Sf3 d5 2.g3', 5),
    ('Seltene erste Züge', 3),
]
# Nummern der PGN-Kapitel (1-basiert) mit (P) auf der Kursseite
PRIORITY = {6, 7, 11, 18, 21, 22, 30, 31, 35, 36}

src, dst = sys.argv[1], sys.argv[2]
text = io.open(src, encoding='utf-8').read()
games = re.split(r'\n\n(?=\[Event )', text)
assert len(games) == sum(n for _, n in LESSONS), (len(games), sum(n for _, n in LESSONS))

names = []
for lesson, n in LESSONS:
    names += [lesson] * n

out = []
for i, g in enumerate(games, 1):
    extra = f'[Lesson "{names[i - 1]}"]\n'
    if i in PRIORITY:
        extra += '[Priority "1"]\n'
    # Header-Block endet vor der ersten Zugzeile: nach dem letzten Header einfügen
    lines = g.split('\n')
    blank = next(k for k, l in enumerate(lines) if not l.strip())
    lines.insert(blank, extra.rstrip('\n'))
    out.append('\n'.join(lines))

io.open(dst, 'w', encoding='utf-8', newline='\n').write('\n\n'.join(out))
print(len(games), 'Kapitel,', len(PRIORITY), 'mit Priorität')
