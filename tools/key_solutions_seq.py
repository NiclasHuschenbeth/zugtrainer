"""Lösungstexte der Schlüsselstellungen den PGN-Stellungen zuordnen (Reihenfolge-Abgleich).

Die Fragen stehen in ODT-Dokumenten in der Reihenfolge des Kurses. Der richtige Zug jeder Frage (Halbzug + Zug)
wird mit den "Schlüsselstellung"-Kommentaren der PGN (ebenfalls in Kursreihenfolge) per Sequenz-Abgleich verbunden.

Formate (automatisch erkannt):
  A/C: getrennte Dokumente. Fragen: Block "N", Diagramm, Antworten "a) 4...Lc5". Lösungen: Zeilen "1c" / "1 c", danach der Text.
  B:   ein Dokument. Block "N", Diagramm, Antworten "1) 8...a6 2) ...", danach eine Zeile "k) Erklärungstext" (k = richtige Antwort).

Aufruf: python key_solutions_seq.py <ausgabe.json> <kurs.pgn> <fragen1.odt[,fragen2.odt...]> [<loesungen1.odt[,loesungen2.odt...]>]
Ohne Lösungsdokumente wird Format B angenommen (Fragen und Lösungen im selben Dokument).
Ergebnis: {"keySolutions": {"<Kapitel>:<Halbzug>:<Zug>": "<Text>"}}  (Kapitel 1-basiert, Halbzug 0-basiert, Zug in englischer SAN)
"""
import difflib
import io
import json
import re
import sys

sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from add_key_solutions import key_nodes, odt_text, san_en  # noqa: E402

MOVE = re.compile(r'(\d+)\s*(\.\.\.|\.\.|\.)\s*(\S+)')


def parse_move(opt):
    m = MOVE.match(opt.strip().lstrip('.').strip())
    if not m:
        return None
    return (int(m.group(1)) - 1) * 2 + (1 if len(m.group(2)) > 1 else 0), san_en(m.group(3))


def split_blocks(text):
    return re.split(r'\n(?=\d+\n+XABCDEFGHY)', text)


def read_sep(q_files, l_files):
    qt = '\n'.join(odt_text(f) for f in q_files)
    lt = '\n'.join(odt_text(f) for f in l_files)
    options = {}
    for b in split_blocks(qt):
        m = re.match(r'\s*(\d+)\n', b)
        if m:
            options[int(m.group(1))] = dict(re.findall(r'^([a-d])\)?\.?\s*(.+)$', b, re.M))
    seq = []
    for n, letter, text in re.findall(r'^(\d+)\s*([a-d])\s*\n(.+)$', lt, re.M):
        opt = options.get(int(n), {}).get(letter)
        mv = parse_move(opt) if opt else None
        if mv:
            seq.append((int(n), mv[0], mv[1], text.strip()))
    seq.sort()
    return seq


def read_one(files):
    seq = []
    for b in split_blocks('\n'.join(odt_text(f) for f in files)):
        m = re.match(r'\s*(\d+)\n', b)
        if not m:
            continue
        opts = {}
        sol = None
        for k, rest in re.findall(r'^(\d)\)\s*(.+)$', b, re.M):
            if len(rest) > 25 or not parse_move(rest):
                sol = (k, rest)  # letzte lange Zeile = Erklärung
            else:
                opts[k] = rest
        if sol and sol[0] in opts:
            mv = parse_move(opts[sol[0]])
            if mv:
                seq.append((int(m.group(1)), mv[0], mv[1], sol[1].strip()))
    return seq


def main(out, pgn, q, l=None):
    qf = q.split(',')
    if l:
        lf = l.split(',')
        if len(qf) == len(lf) and len(qf) > 1:
            seq = [x for a, b in zip(qf, lf) for x in read_sep([a], [b])]  # Nummerierung kann pro Teil neu beginnen
        else:
            seq = read_sep(qf, lf)
    else:
        seq = read_one(qf)
    text = io.open(pgn, encoding='utf-8-sig').read()
    games = re.split(r'\n\n(?=\[Event )', text)
    keys = [(ci, ply, san) for ci, g in enumerate(games, 1) for san, ply in key_nodes(g.partition('\n\n')[2])]
    a = [(p, s) for _, p, s, _ in seq]
    b = [(ply, san) for _, ply, san in keys]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    res = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ci, ply, san = keys[blk.b + k]
            res[f'{ci}:{ply}:{san}'] = seq[blk.a + k][3]
    io.open(out, 'w', encoding='utf-8').write(json.dumps({'keySolutions': res}, ensure_ascii=False, indent=1))
    print(f'{len(seq)} Fragen mit Lösung, {len(keys)} Schlüsselstellungen im PGN, {len(res)} zugeordnet, {len(seq) - len(res)} Fragen ohne Treffer')


if __name__ == '__main__':
    main(*sys.argv[1:])
