"""Baut das SQL zum Laden eines Kurses in die Supabase-Tabelle courses (siehe supabase-courses*.sql).

Aufruf:
  python make_course_sql.py <ausgabe.sql> <id> <ablefy-produktnummer> "<Name>" <white|black> <kurs.pgn> <loesungstexte.json|-> <videos.json|->
Mehrere Kurse in eine Datei: Aufruf mit >> bzw. das Skript mehrfach mit demselben Ziel aufrufen (hängt an, wenn die Datei existiert und --append gesetzt ist).
Die Texte stehen in $dollar$-Quotes; vorhandene Kurse gleicher id werden aktualisiert (version + 1).
"""
import io
import json
import os
import sys


def lit(tag, text):
    assert f'${tag}$' not in text
    return f'${tag}${text}${tag}$'


def main(out, cid, product, name, color, pgn, sol, vid, append=None):
    p = io.open(pgn, encoding='utf-8-sig').read()
    s = json.load(io.open(sol, encoding='utf-8'))['keySolutions'] if sol != '-' else {}
    v = json.load(io.open(vid, encoding='utf-8')) if vid != '-' else {}
    assert color in ('white', 'black')
    sql = (
        'insert into public.courses (id, product_id, name, color, pgn, key_solutions, videos) values ('
        f"'{cid}', '{product}', {lit('nm', name)}, '{color}', {lit('pgn', p)}, "
        f"{lit('ks', json.dumps(s, ensure_ascii=False))}::jsonb, {lit('vd', json.dumps(v, ensure_ascii=False))}::jsonb) "
        'on conflict (id) do update set name = excluded.name, pgn = excluded.pgn, key_solutions = excluded.key_solutions, '
        'videos = excluded.videos, version = courses.version + 1, updated_at = now();\n'
    )
    mode = 'a' if append and os.path.exists(out) else 'w'
    io.open(out, mode, encoding='utf-8', newline='\n').write(sql)
    print(f'{cid}: {len(p)} Zeichen PGN, {len(s)} Lösungstexte, {len(v)} Videolinks')


if __name__ == '__main__':
    args = sys.argv[1:]
    append = '--append' in args
    main(*[a for a in args if a != '--append'], append=append)
