# Modern Chess Trainer

Eröffnungsrepertoires lernen, wiederholen und mit den eigenen Online-Partien abgleichen.

- **Repertoires:** PGN hochladen (Varianten und Kommentare, z. B. Export einer Lichess-Studie). Jede Partie ist ein Kapitel, jede Variante eine Linie.
- **Trainer:** „Lernen“ spielt neue Züge vor und fragt sie ab, „Wiederholen“ fragt fällige Züge ab
  (4 Std. → 1 Tag → 3 Tage → 1 Woche → 2 Wochen → 1 Monat → 3 Monate → 6 Monate, Fehler = zurück auf Stufe 1).
- **Partien:** Import über Benutzernamen von Lichess und Chess.com (öffentliche Schnittstellen, kein Passwort).
- **Abgleich:** erste Abweichung vom Repertoire pro Partie; eigene Fehler lassen sich direkt trainieren.
- **Editor:** Züge, Varianten, Kommentare, Zug- und Stellungsbewertungen, Pfeile, Kapitel (auch aus FEN/PGN), PGN-Export,
  Stockfish 19, Cloud-Bewertungen (ChessDB), Lichess-Eröffnungsdatenbank, Musterpartien, Abdeckungsprüfung.
- **Testpartie:** Repertoire gegen Gegnerzüge nach echter Häufigkeit (Lichess) oder gegen Stockfish spielen; die Engine bewertet am Ende.
- **Offline:** Nach dem ersten Laden funktioniert alles ohne Internet, was keine fremden Dienste braucht. Als App installierbar (PWA).

Alle Daten (Repertoires, Fortschritt, Partien) liegen zunächst nur im Browser des Nutzers (IndexedDB). Mit einem kostenlosen
Konto (Anmeldung per E-Mail-Link, [Supabase](https://supabase.com)) werden Repertoires, Lernfortschritt, Tagesziel und Einstellungen
zwischen Geräten abgeglichen. Importierte Partien und das Lichess-Token bleiben immer lokal. Der Abgleich ist offline-first:
alles funktioniert ohne Internet und gleicht sich danach nach festen Regeln pro Eintrag ab (siehe `js/lib/sync.js`).
Die Tabellen und Zugriffsregeln stehen in `tools/supabase-schema.sql`; geprüft wird der Abgleich mit `tools/sync-test.mjs`.
Die Lichess-Eröffnungsdatenbank verlangt eine Lichess-Anmeldung des Nutzers (OAuth, ohne Rechte auf dem Konto).

## Lokal starten

Rein statische Seite ohne Build-Schritt. Ein beliebiger Webserver genügt:

```bash
python -m http.server 5173
```

Dann http://localhost:5173 öffnen. (Doppelklick auf `index.html` funktioniert nicht, weil Browser ES-Module nur über http laden.)

## Vor dem Hochladen

Nach jeder Änderung an Dateien einmal ausführen. Das aktualisiert die Dateiliste und Versionsnummer in `sw.js`,
damit installierte Geräte die neue Version bekommen:

```bash
python tools/build.py .
```

In `js/config.js` stehen die Links für Quellcode, Impressum und Datenschutz im Seitenfuß.

## Veröffentlichen

Den ganzen Ordner bei einem Anbieter für statische Seiten hochladen (Cloudflare Pages, Netlify, GitHub Pages, eigener Webspace).
`_headers` enthält die Einstellungen für Cloudflare Pages und Netlify.

## Aufbau

- `js/lib/` – Logik (u. a. `sync.js` Abgleich, `cloud.js` Supabase-Anbindung): `repertoire.js` (PGN → Baum/Linien), `srs.js` (Wiederholungsplan), `games.js` (Import), `analysis.js` (Abgleich),
  `coverage.js` (Abdeckung), `engine.js` (Stockfish), `chessdb.js`, `lichess.js` (Anmeldung, Datenbank), `storage.js`
- `js/ui/` – Oberfläche: `trainer.js`, `editor.js`, `scrim.js` (Testpartie), `repertoires.js`, `games.js`, `compare.js`, `board.js`
- `vendor/` – eingebundene Bibliotheken mit ihren Lizenzen
- `sw.js`, `manifest.webmanifest`, `icons/` – Offline-Modus und App-Installation

## Lizenz

GPL-3.0, siehe `LICENSE`. Der Zugtrainer nutzt
[chessground](https://github.com/lichess-org/chessground) und [chessops](https://github.com/niklasf/chessops) (GPL-3.0),
[Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0), [Preact](https://preactjs.com) und htm (MIT / Apache-2.0)
sowie @badrap/result (MIT). Wer die Seite veröffentlicht, muss den Quelltext zugänglich machen.
