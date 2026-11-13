"""Erzeugt die Lösungstexte der Schlüsselstellungen als eigene JSON-Datei (die PGN bleibt unverändert).

Quelle der Texte: die Dokumente "Schlüsselstellungen_komplett.odt" (Fragen mit Antwortzügen a/b/c)
und "Lösungen_komplett.odt" (Überschrift "1c (aus Nr.1)" = Frage 1, richtige Antwort c, Kapitel 1 der PGN).
Zuordnung zur Stellung: Kapitel der PGN + Halbzug-Nummer + richtiger Zug.
Ergebnis: {"keySolutions": {"<Kapitel>:<Halbzug>:<Zug>": "<Text>"}}  (Kapitel 1-basiert, Halbzug 0-basiert,
Zug in englischer SAN ohne Schach-/Wertungszeichen).

Aufruf: python add_key_solutions.py <fragen.odt> <loesungen.odt> <kurs.pgn> <ausgabe.json>
Die PGN wird nur gelesen.
"""
import html
import io
import json
import re
import sys
import zipfile


def odt_text(path):
    x = zipfile.ZipFile(path).read('content.xml').decode('utf-8')
    x = re.sub(r'</text:(p|h)>', '\n', x)
    x = re.sub(r'<text:line-break/>', '\n', x)
    x = re.sub(r'<[^>]+>', '', x)
    return html.unescape(x)


DE2EN = str.maketrans({'S': 'N', 'L': 'B', 'T': 'R', 'D': 'Q'})


def san_en(de):
    s = de.strip().translate(DE2EN)
    s = re.sub(r'[+#!?]+', '', s)
    return s.replace('0-0-0', 'O-O-O').replace('0-0', 'O-O')


def read_docs(fq, fl):
    q = odt_text(fq)
    blocks = re.split(r'\n(?=\d+\n+XABCDEFGHY)', q)
    options = {}
    for b in blocks:
        m = re.match(r'\s*(\d+)\n', b)
        if m:
            options[int(m.group(1))] = dict(re.findall(r'^([a-d])\)\s*(.+)$', b, re.M))
    sols = []
    for n, letter, chap, text in re.findall(r'^(\d+)([a-d])\s*\(aus Nr\.(\d+)\)\n(.+)$', odt_text(fl), re.M):
        opt = options[int(n)][letter]  # z. B. "3...Sge7" oder "7.Lg5"
        m = re.match(r'(\d+)(\.\.\.|\.)\s*(\S+)', opt)
        num, dots, mv = int(m.group(1)), m.group(2), san_en(m.group(3))
        ply = (num - 1) * 2 + (1 if dots == '...' else 0)  # 0-basierter Halbzug des richtigen Zugs
        sols.append({'n': int(n), 'chapter': int(chap), 'ply': ply, 'san': mv, 'text': text.strip()})
    return sols


TOKEN = re.compile(r'\{[^}]*\}|\(|\)|\$\d+|\d+\.(?:\.\.)?|;[^\n]*|[^\s(){}$]+')
RESULT = {'1-0', '0-1', '1/2-1/2', '*'}
KEY = re.compile(r'^\s*(?:\[%[^\]]*\]\s*)*Schl[üu]e?sselstellung', re.I)


def key_nodes(movetext):
    """Liefert [(richtiger Zug (SAN ohne Zeichen), Halbzug-Nummer)] der Schlüsselstellungen (in Textreihenfolge)."""
    root = {'san': None, 'ply': -1, 'children': [], 'parent': None}
    cur = root
    stack = []
    keys = []
    for m in TOKEN.finditer(movetext):
        t = m.group(0)
        if t.startswith('{'):
            if cur is not root and KEY.match(t[1:-1]):
                keys.append(cur)
        elif t == '(':
            stack.append(cur)
            cur = cur['parent']  # Variante ersetzt den letzten Zug
        elif t == ')':
            cur = stack.pop()
        elif t.startswith('$') or t.startswith(';') or re.match(r'\d+\.', t) or t in RESULT:
            continue
        else:
            node = {'san': re.sub(r'[+#!?]+', '', t), 'ply': cur['ply'] + 1, 'children': [], 'parent': cur}
            cur['children'].append(node)
            cur = node
    return [(n['children'][0]['san'], n['children'][0]['ply']) for n in keys if n['children']]


def main(fq, fl, src, dst):
    sols = read_docs(fq, fl)
    by = {(s['chapter'], s['ply'], s['san']): s for s in sols}
    text = io.open(src, encoding='utf-8-sig').read()
    games = re.split(r'\n\n(?=\[Event )', text)
    per_chapter = [key_nodes(g.partition('\n\n')[2]) for g in games]
    used = {by[(ci, ply, san)]['n'] for ci, ks in enumerate(per_chapter, 1) for san, ply in ks if (ci, ply, san) in by}
    # Zweiter Durchgang: die Kapitelnummern der Dokumente weichen teils ab -> über (Halbzug, Zug) zuordnen,
    # aber nur, wenn das eindeutig ist.
    left_docs = [s for s in sols if s['n'] not in used]
    left_pgn = [(ci, ply, san) for ci, ks in enumerate(per_chapter, 1) for san, ply in ks if (ci, ply, san) not in by]
    extra = {}
    for s in left_docs:
        cands = [k for k in left_pgn if k[1] == s['ply'] and k[2] == s['san']]
        same = [d for d in left_docs if d['ply'] == s['ply'] and d['san'] == s['san']]
        if len(cands) == 1 and len(same) == 1:
            extra[cands[0]] = s
            used.add(s['n'])
    result, missing = {}, []
    for ci, ks in enumerate(per_chapter, 1):
        for san, ply in ks:
            s = by.get((ci, ply, san)) or extra.get((ci, ply, san))
            if s:
                result[f'{ci}:{ply}:{san}'] = s['text']
            else:
                missing.append((ci, ply, san))
    io.open(dst, 'w', encoding='utf-8', newline='\n').write(json.dumps({'keySolutions': result}, ensure_ascii=False, indent=1))
    print(f'{len(sols)} Lösungstexte, {len(used)} zugeordnet, {len(sols) - len(used)} ohne Zuordnung')
    print(f'{len(result)} Schlüsselstellungen mit Text, {len(missing)} ohne:', missing)


if __name__ == '__main__':
    main(*sys.argv[1:5])
