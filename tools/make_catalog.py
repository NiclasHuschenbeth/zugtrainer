"""Erzeugt die öffentliche Kursliste für die Repertoire-Empfehlung (js/lib/catalog-data.js).

Pro Kurs stehen dort nur Titel, Link, Kurztext und die "Kennstellungen": Kürzel aller Stellungen der ersten
MAX_PLY Halbzüge des Kurses. Damit erkennt der Trainer auf dem Gerät des Nutzers, zu welchem Kurs eine Partie
passt, ohne dass der Kursinhalt öffentlich wird.

Aufruf (im Ordner zugtrainer):  python tools/make_catalog.py ..
Das Argument ist der Ordner, in dem die Ordner "<Kurs>-fuer-den-Trainer" mit den Kurs-PGNs liegen.
Braucht python-chess (pip install chess).
"""
import io, json, os, sys
import chess, chess.pgn

MAX_PLY = 12

# Reihenfolge = Vorrang bei Gleichstand. level: 'club' = für Spieler bis ca. 1800, 'all' = für alle Spielstärken.
COURSES = [
    dict(id='289015', title='Gewinnen mit 1.e4', color='white', level='club', courseIds=['gewinnen-e4'],
         url='https://modernchess.de/gewinnen-mit-e4/', played='mit Weiß 1.e4 gespielt',
         text='Komplettes Weiß-Repertoire mit 1.e4 für Spieler bis etwa 1800 DWZ.',
         files=['GewinnenE4-fuer-den-Trainer/E4.pgn']),
    dict(id='341983', title='Spiele 1.e4 wie The Big Greek', color='white', level='all', courseIds=['341983-basis', '341983-fortgeschritten'],
         url='https://modernchess.de/spiele-1e4-wie-the-big-greek/', played='mit Weiß 1.e4 gespielt',
         text='Komplettes Weiß-Repertoire mit 1.e4 und scharfen, weniger bekannten Varianten, von IM Georgios Souleidis.',
         files=['BigGreek-fuer-den-Trainer/Basis.pgn', 'BigGreek-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='321430', title='Das Neo-Londoner System', color='white', level='all', courseIds=['321430'],
         url='https://modernchess.de/neo-londoner-system/', played='mit Weiß 1.d4 gespielt',
         text='Komplettes Weiß-Repertoire auf Basis eines verbesserten Londoner Systems.',
         files=['NeoLondoner-fuer-den-Trainer/Neo.pgn']),
    dict(id='443257', title='Das Keymer-System', color='white', level='all', courseIds=['443257'],
         url='https://modernchess.de/keymer-system/', played='mit Weiß 1.Sf3 gespielt',
         text='Komplettes Weiß-Repertoire mit 1.Sf3, von GM Jan Gustafsson.',
         files=['Keymer-fuer-den-Trainer/Keymer.pgn']),
    dict(id='294737', title='Gewinnen mit Schwarz', color='black', level='club', courseIds=['294737'],
         url='https://modernchess.de/gewinnen-mit-schwarz',
         text='Komplettes Schwarz-Repertoire für Spieler bis etwa 1800 DWZ.',
         files=['GewinnenSchwarz-fuer-den-Trainer/Schwarz.pgn']),
    dict(id='471814', title='Bulletproof Repertoire: Russisch', color='black', level='all', courseIds=['471814-basis', '471814-fortgeschritten'],
         url='https://modernchess.de/russisch', played='mit Schwarz 1.e4 e5 gespielt',
         text='Ein Schwarz-Repertoire gegen 1.e4, das ein Schachleben lang hält.',
         files=['Russisch-fuer-den-Trainer/Basis.pgn', 'Russisch-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='286399', title='Najdorf für Gewinner', color='black', level='all', courseIds=['najdorf-basis', 'najdorf-fortgeschritten'],
         url='https://shop.modernchess.de/s/modernchess/najdorf-fuer-gewinner', played='mit Schwarz Sizilianisch gespielt',
         text='Die Najdorf-Variante der Sizilianischen Verteidigung für Schwarz.',
         files=['Najdorf-fuer-den-Trainer/Basis.pgn', 'Najdorf-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='289014', title='Schlage die Anti-Sizilianer', color='black', level='all', courseIds=['289014-basis', '289014-fortgeschritten'],
         url='https://shop.modernchess.de/s/modernchess/schlage-die-antisizilianer', played='mit Schwarz Sizilianisch gegen Nebenvarianten gespielt',
         text='So begegnest du den Nebenvarianten gegen Sizilianisch (Alapin, Geschlossen, Lb5 und andere).',
         files=['AntiSizilianer-fuer-den-Trainer/Basis.pgn', 'AntiSizilianer-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='394211', title='Bulletproof Repertoire: Angenommenes Damengambit', color='black', level='all', courseIds=['394211-basis', '394211-fortgeschritten'],
         url='https://modernchess.de/angenommenes-damengambit', played='mit Schwarz 1.d4 d5 gespielt',
         text='Ein Schwarz-Repertoire gegen 1.d4 auf Basis des Angenommenen Damengambits.',
         files=['Damengambit-fuer-den-Trainer/Basis.pgn', 'Damengambit-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='473844', title='Bulletproof Repertoire vs. 1.Sf3 & 1.c4', color='black', level='all', courseIds=['473844-basis', '473844-fortgeschritten'],
         url='https://modernchess.de/bulletproof-repertoire-vs-sf3-c4', played='mit Schwarz gegen 1.c4 oder 1.Sf3 gespielt',
         text='Ein Schwarz-Repertoire gegen 1.Sf3, 1.c4 und seltenere erste Züge.',
         files=['Bulletproof-fuer-den-Trainer/Basis.pgn', 'Bulletproof-fuer-den-Trainer/Fortgeschritten.pgn']),
    dict(id='536725', title='Das Ragger-System', color='black', level='all', courseIds=['536725-basis', '536725-fortgeschritten'],
         url='https://modernchess.de/ragger-system/', played='mit Schwarz 1.d4 d5 gespielt',
         text='Semi-Slawisch gegen 1.d4, 1.c4 und 1.Sf3: ein Schwarz-System fürs Leben, von GM Markus Ragger.',
         files=['Ragger-fuer-den-Trainer/Basis.pgn', 'Ragger-fuer-den-Trainer/Fortgeschritten.pgn']),
]

# Pakete: werden statt der Einzelkurse empfohlen, wenn alle enthaltenen Kurse passen.
BUNDLES = [
    dict(id='sizilianisch-masterclass', title='Sizilianisch Masterclass', parts=['286399', '289014'],
         url='https://shop.modernchess.de/s/modernchess/sizilianisch-masterclass', played='mit Schwarz Sizilianisch gespielt',
         text='Komplettes Schwarz-Repertoire gegen 1.e4: Najdorf und alle Anti-Sizilianer in einem Paket.'),
]


def fnv(s):
    """FNV-1a (32 Bit) wie in js/lib/recommend.js, als Text zur Basis 36."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        out = digits[h % 36] + out
        h //= 36
        if not h:
            return out


def fingerprint(root, files):
    keys = set()

    def walk(node, board, ply):
        if ply >= MAX_PLY:
            return
        for child in node.variations:
            board.push(child.move)
            keys.add(fnv(board.epd()))
            walk(child, board, ply + 1)
            board.pop()

    chapters = 0
    firsts = {}
    for f in files:
        text = open(os.path.join(root, f), encoding='utf-8-sig', errors='replace').read()
        stream = io.StringIO(text)
        while True:
            game = chess.pgn.read_game(stream)
            if game is None:
                break
            if game.headers.get('FEN'):
                continue  # Kapitel ohne Grundstellung taugen nicht zur Zuordnung
            chapters += 1
            if game.variations:
                san = game.board().san(game.variations[0].move)
                firsts[san] = firsts.get(san, 0) + 1
            walk(game, game.board(), 0)
    # Erste Züge, mit denen mindestens 5 % der Kapitel beginnen (seltene Umstellungen zählen nicht)
    first = sorted((m for m, n in firsts.items() if n >= 0.05 * chapters), key=lambda m: -firsts[m])
    return sorted(keys), chapters, first


def main():
    root = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    out = []
    for c in COURSES:
        fp, chapters, first = fingerprint(root, c['files'])
        entry = {k: v for k, v in c.items() if k != 'files'}
        entry['cover'] = f"icons/courses/{c['id']}.jpg"
        entry['first'] = first
        entry['fp'] = ' '.join(fp)
        out.append(entry)
        print(f"{c['title'].encode('ascii', 'replace').decode()}: {chapters} Kapitel, {len(fp)} Kennstellungen, erste Zuege {first}")
    bundles = [dict(b, cover=f"icons/courses/{b['id']}.jpg") for b in BUNDLES]
    js = ('// Öffentliche Kursliste für die Repertoire-Empfehlung. Automatisch erzeugt von tools/make_catalog.py, nicht von Hand ändern.\n'
          '// fp = Kürzel der Stellungen aus den ersten ' + str(MAX_PLY) + ' Halbzügen des Kurses (kein Kursinhalt).\n'
          'export const MAX_PLY = ' + str(MAX_PLY) + ';\n'
          'export const COURSES = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n'
          'export const BUNDLES = ' + json.dumps(bundles, ensure_ascii=False, indent=1) + ';\n')
    path = os.path.join(here, '..', 'js', 'lib', 'catalog-data.js')
    io.open(path, 'w', encoding='utf-8', newline='\n').write(js)
    print('geschrieben:', os.path.normpath(path), len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
