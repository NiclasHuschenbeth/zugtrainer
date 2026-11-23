import { html, useEffect, useReducer, useRef, useState } from 'preact';
import { de } from '../lib/repertoire.js';
import { chessgroundDests } from 'chessops/compat.js';
import { INITIAL_FEN, makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { parseSquare, parseUci } from 'chessops/util.js';
import { moveKeys, moveLabel, moveText, posFromFen, turnOf, whiteLabel } from '../lib/repertoire.js';
import { downloadPgn } from '../lib/pgnexport.js';
import { StockfishEngine, formatScore } from '../lib/engine.js';
import { PRESETS, explore, masterGames, masterPgn, startLogin } from '../lib/lichess.js';
import { cdbMoves, cdbQueue, formatCloud } from '../lib/chessdb.js';
import { lineText, scanCoverage } from '../lib/coverage.js';
import { parsePgn, startingPosition } from 'chessops/pgn.js';
import { epdOf, parseRepertoirePgn } from '../lib/repertoire.js';
import { Board } from './board.js';
import { authorOf, lastKnown, refsAt } from '../lib/reference.js';

const GLYPHS = ['!', '?', '!!', '??', '!?', '?!'];
const POS = [['=', 'ausgeglichen'], ['∞', 'unklar'], ['⩲', 'Weiß steht etwas besser'], ['⩱', 'Schwarz steht etwas besser'], ['±', 'Weiß steht besser'], ['∓', 'Schwarz steht besser'], ['+−', 'Weiß steht auf Gewinn'], ['−+', 'Schwarz steht auf Gewinn']];
const annotated = n => !!(n.comment || (n.shapes && n.shapes.length));

const NARROW = '(max-width: 820px)';
/** Schmaler Bildschirm (Handy)? Dort ist die Zugliste ein eigener Reiter. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Editor({ rep, at, focus, settings, setSettings, saveRep, onExit, free, refs = [] }) {
  const work = useRef(null);
  if (!work.current) work.current = structuredClone(rep);
  const w = work.current;
  const [, force] = useReducer(x => x + 1, 0);
  const [ci, setCi] = useState(at && w.chapters[at.ci] ? at.ci : 0);
  const [path, setPath] = useState(at ? at.path : []);
  const [flipped, setFlipped] = useState(false);
  const orient = flipped ? (w.color === 'white' ? 'black' : 'white') : w.color;
  const [ready, setReady] = useState(false);
  const [best, setBest] = useState(null);
  const [cloudEval, setCloudEval] = useState(null);
  const [promo, setPromo] = useState(null); // Bauernumwandlung: { from, to } wartet auf Figurenwahl
  const [addOpen, setAddOpen] = useState(false);
  const [more, setMore] = useState(false);
  const narrow = useNarrow();
  const [tab, setTab] = useState(() => (matchMedia(NARROW).matches ? 'moves' : 'overview')); // moves (nur schmal) | overview | engine | cloud | db | refs | games
  const arrows = settings.varArrows !== false;
  const cg = useRef(null);
  const timer = useRef(null);
  const dirty = useRef(false); // nur speichern, wenn wirklich etwas geändert wurde (wichtig für Kurse: "bearbeitet" oder nicht)

  // Änderungen am Arbeitsstand speichern (leicht verzögert, damit Tippen flüssig bleibt)
  const commit = () => {
    force();
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRep({ ...w }), 400);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) saveRep({ ...w });
    },
    [],
  );

  const chapter = w.chapters[ci];
  const trail = [];
  {
    let kids = chapter.children;
    for (const i of path) {
      if (!kids[i]) break;
      trail.push(kids[i]);
      kids = kids[i].children;
    }
  }
  const node = trail[trail.length - 1] || null;
  const fen = node ? node.fen : chapter.startFen;
  const kids = node ? node.children : chapter.children;
  const siblings = trail.length > 1 ? trail[trail.length - 2].children : chapter.children;

  useEffect(() => {
    const c = cg.current;
    if (!c) return;
    const pos = posFromFen(fen);
    c.set({
      fen,
      orientation: orient,
      turnColor: turnOf(fen),
      lastMove: node ? [node.from, node.to] : undefined,
      check: pos.isCheck(),
      movable: { color: turnOf(fen), dests: chessgroundDests(pos) },
    });
    c.setShapes(node && node.shapes ? node.shapes.map(s => ({ ...s })) : []);
  }, [fen, ready, orient, ci, promo]);

  useEffect(() => {
    if (!cg.current) return;
    const shapes = [];
    if (arrows) kids.forEach((k, i) => shapes.push({ orig: k.from, dest: k.to, brush: i ? 'paleGrey' : 'paleGreen' }));
    if (best && best.fen === fen) shapes.push({ orig: best.from, dest: best.to, brush: 'paleBlue' });
    cg.current.setAutoShapes(shapes);
  }, [best, fen, ready, arrows, kids.length, ci]);

  const playMove = move => {
    const pos = posFromFen(fen);
    if (!move || !pos.isLegal(move)) return;
    const [from, to] = moveKeys(pos, move);
    const next = pos.clone();
    const san = makeSanAndPlay(next, move);
    let idx = kids.findIndex(k => k.san === san);
    if (idx < 0) {
      const n = { san, from, to, fen: makeFen(next.toSetup()), children: [] };
      if (move.promotion) n.promotion = move.promotion;
      kids.push(n);
      idx = kids.length - 1;
      commit();
    }
    setPath([...path.slice(0, trail.length), idx]);
  };

  /** Mehrere Züge hintereinander (Variante der Engine) ab der aktuellen Stellung in die Notation übernehmen. */
  const playLine = ucis => {
    const pos = posFromFen(fen);
    const p = path.slice(0, trail.length);
    let list = kids;
    let changed = false;
    for (const uci of ucis) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) break;
      const [from, to] = moveKeys(pos, move);
      const san = makeSanAndPlay(pos, move);
      let idx = list.findIndex(k => k.san === san);
      if (idx < 0) {
        const n = { san, from, to, fen: makeFen(pos.toSetup()), children: [] };
        if (move.promotion) n.promotion = move.promotion;
        list.push(n);
        idx = list.length - 1;
        changed = true;
      }
      p.push(idx);
      list = list[idx].children;
    }
    if (changed) commit();
    setPath(p);
  };

  const onBoardMove = (orig, dest) => {
    const pos = posFromFen(fen);
    const move = { from: parseSquare(orig), to: parseSquare(dest) };
    const piece = pos.board.get(move.from);
    if (piece && piece.role === 'pawn' && (move.to >> 3 === 0 || move.to >> 3 === 7)) return setPromo(move);
    playMove(move);
  };
  const choosePromo = role => {
    const move = { ...promo, promotion: role };
    setPromo(null);
    playMove(move);
  };

  const onShapes = shapes => {
    if (!node) return;
    const clean = shapes.map(s => (s.dest ? { orig: s.orig, dest: s.dest, brush: s.brush } : { orig: s.orig, brush: s.brush }));
    if (clean.length) node.shapes = clean;
    else delete node.shapes;
    commit();
  };

  const back = () => setPath(path.slice(0, Math.max(0, trail.length - 1)));
  const forward = () => kids.length && setPath([...path.slice(0, trail.length), 0]);
  const toEnd = () => {
    const p = path.slice(0, trail.length);
    let k = kids;
    while (k.length) {
      p.push(0);
      k = k[0].children;
    }
    setPath(p);
  };

  const keyRef = useRef(null);
  keyRef.current = ev => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowLeft') back();
    else if (ev.key === 'ArrowRight') forward();
    else if (ev.key === 'ArrowUp') setPath([]);
    else if (ev.key === 'ArrowDown') toEnd();
    else if (ev.key === 'f' && !ev.ctrlKey && !ev.metaKey) setFlipped(v => !v);
    else return;
    ev.preventDefault();
  };
  useEffect(() => {
    const h = ev => keyRef.current(ev);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const removeNode = () => {
    if (!node) return;
    siblings.splice(path[trail.length - 1], 1);
    setPath(path.slice(0, trail.length - 1));
    commit();
  };
  const promote = () => {
    const i = path[trail.length - 1];
    if (!node || i === 0) return;
    siblings.splice(i, 1);
    siblings.unshift(node);
    setPath([...path.slice(0, trail.length - 1), 0]);
    commit();
  };
  const setGlyph = g => {
    if (node.glyph === g) delete node.glyph;
    else node.glyph = g;
    commit();
  };
  const setPos = g => {
    if (node.pos === g) delete node.pos;
    else node.pos = g;
    commit();
  };
  const setComment = text => {
    if (text) node.comment = text;
    else delete node.comment;
    commit();
  };

  const addChapters = list => {
    w.chapters.push(...list);
    setCi(w.chapters.length - list.length);
    setPath([]);
    setAddOpen(false);
    commit();
  };

  const engineEval = best && best.fen === fen && (best.cp != null || best.mate != null) ? best : null;
  const ev = engineEval || (cloudEval && cloudEval.fen === fen ? cloudEval : null);
  // Stellung per FEN: im Analyse-Brett ersetzt sie das Brett, im Repertoire wird daraus ein neues Kapitel
  const loadFen = text => {
    const pos = posFromFen(text.trim()); // wirft bei ungültiger FEN
    const startFen = makeFen(pos.toSetup());
    if (free) {
      w.chapters = [{ name: 'Analyse', startFen, children: [] }];
      setCi(0);
      setPath([]);
      commit();
    } else addChapters([{ name: `Kapitel ${w.chapters.length + 1} (FEN)`, startFen, children: [] }]);
  };

  const removeChapter = () => {
    if (w.chapters.length < 2 || !confirm(`Kapitel „${chapter.name}“ löschen?`)) return;
    w.chapters.splice(ci, 1);
    setCi(0);
    setPath([]);
    commit();
  };

  const infoTab = !narrow && tab === 'moves' ? 'overview' : tab;
  const TABS = [['moves', 'Züge'], ['overview', 'Übersicht'], ['engine', 'Stockfish'], ['cloud', 'Cloud'], ['db', 'Datenbank'], ...(refs.length ? [['refs', 'Repertoires']] : []), ['games', 'Partien']];

  // Referenz: Züge aus den anderen Repertoires (Kurse, hochgeladene, eigene) in dieser Stellung
  const refOff = settings.refOff || {};
  const refReps = refs.filter(r => !refOff[r.id]);
  const hits = refsAt(refReps, fen);
  const fens = [chapter.startFen, ...trail.map(n => n.fen)];
  const known = hits.length ? fens.length - 1 : lastKnown(refReps, fens);
  const lastText = known > 0 ? `nach ${moveText(known > 1 ? trail[known - 2].fen : chapter.startFen, trail[known - 1].san)}` : 'ab der Ausgangsstellung';
  const playSan = san => playMove(parseSan(posFromFen(fen), san));

  return html`<div class=${`editor v2 ${free ? 'free' : ''}`}>
    <div class="editor-board">
      <div class="boardrow">
        <${EvalBar} ev=${ev} whiteBelow=${orient === 'white'} />
        <${Board} orientation=${orient} onReady=${c => { cg.current = c; setReady(true); }} onMove=${onBoardMove} onShapes=${onShapes} />
      </div>
      ${promo && html`<div class="row promo">
        <b>Umwandeln in:</b>
        ${[['queen', 'Dame'], ['rook', 'Turm'], ['bishop', 'Läufer'], ['knight', 'Springer']].map(([r, t]) => html`<button class="btn small" onClick=${() => choosePromo(r)}>${t}</button>`)}
        <button class="btn small ghost" onClick=${() => setPromo(null)}>Abbrechen</button>
      </div>`}
      <div class="row nav">
        <button class="btn small" onClick=${() => setPath([])} title="Zum Anfang (↑)">⏮</button>
        <button class="btn small" onClick=${back} title="Zug zurück (←)">◀</button>
        <button class="btn small" onClick=${forward} title="Zug vor (→)">▶</button>
        <button class="btn small" onClick=${toEnd} title="Zum Ende (↓)">⏭</button>
        <button class="btn small" onClick=${() => setFlipped(!flipped)} title="Brett drehen (F)">⇅ Drehen</button>
        <label class="check small" title="Zeigt die Züge, die an dieser Stelle schon im Repertoire stehen, als Pfeile"><input type="checkbox" checked=${arrows} onChange=${e => setSettings({ varArrows: e.target.checked })} /> Pfeile</label>
      </div>
      <${FenRow} fen=${fen} free=${free} onLoad=${loadFen} />
      ${refReps.length > 0 && (hits.length > 0 || known >= 0) && html`<div class="ref-line small" title="Züge aus deinen Repertoires in dieser Stellung (Details im Reiter „Repertoires“)">
        ${hits.length
          ? hits.map(h => html`<span class="ref-item"><span class="muted">${h.rep.name}:</span>${' '}${h.moves.length
              ? html`${h.moves.slice(0, 3).map((m, i) => html`${i ? ' ' : ''}<button class=${`link ref-move ${m.main && m.own ? 'main' : ''}`} onClick=${() => playSan(m.san)}>${moveText(fen, m.san)}</button>`)}${h.moves.length > 3 && html`${' '}<button class="link muted" title="Alle Züge im Reiter „Repertoires“" onClick=${() => setTab('refs')}>+${h.moves.length - 3}</button>`}`
              : html`<span class="muted">Variante endet</span>`}</span>`)
          : html`<span class="muted">Nicht mehr im Repertoire (zuletzt ${lastText})</span>`}
      </div>`}
    </div>

    <div class="editor-side">
      <div class="card ed-head">
        <div class="row between">
          <b class="ed-title">${free ? 'Analyse' : w.name}</b>
          <span class="row">
            <button class=${`btn small ${more ? 'on' : ''}`} aria-expanded=${more} onClick=${() => setMore(!more)} title="Name, Farbe, Kapitel, PGN-Export">⋯ Mehr</button>
            <button class="btn primary small" onClick=${onExit}>${free ? 'Schließen' : 'Fertig'}</button>
          </span>
        </div>
        ${(!free || w.chapters.length > 1) && html`<select aria-label="Kapitel" value=${ci} onChange=${e => { setCi(+e.target.value); setPath([]); }}>
          ${w.chapters.map((c, i) => html`<option value=${i}>${i + 1}. ${c.name}</option>`)}
        </select>`}
        ${more && html`<div class="ed-more stack tight">
          ${!free && html`<div class="grid2">
            <label>Name des Repertoires
              <input type="text" value=${w.name} onInput=${e => { w.name = e.target.value || 'Repertoire'; commit(); }} />
            </label>
            <label>Farbe
              <select value=${w.color} onChange=${e => { w.color = e.target.value; commit(); }}>
                <option value="white">Repertoire für Weiß</option>
                <option value="black">Repertoire für Schwarz</option>
              </select>
            </label>
            ${!String(w.id).startsWith('course-') && html`<label>Autor (freiwillig)
              <input type="text" value=${w.author || ''} onInput=${e => { w.author = e.target.value.trim() || undefined; commit(); }} />
            </label>`}
          </div>`}
          <label>Name dieses Kapitels
            <input type="text" value=${chapter.name} onInput=${e => { chapter.name = e.target.value || 'Kapitel'; commit(); }} />
          </label>
          <div class="row">
            <button class="btn small" onClick=${() => setAddOpen(!addOpen)}>+ Kapitel</button>
            <button class="btn small danger" disabled=${w.chapters.length < 2} onClick=${removeChapter}>Kapitel löschen</button>
            <button class="btn small" onClick=${() => downloadPgn(w)}>PGN exportieren</button>
          </div>
          ${addOpen && html`<${ChapterForm} count=${w.chapters.length} onAdd=${addChapters} onCancel=${() => setAddOpen(false)} />`}
          <div class="muted small">Züge gibst du auf dem Brett ein. Ein zweiter Zug in derselben Stellung legt eine Variante an. Pfeile und Markierungen zeichnest du mit der rechten Maustaste.</div>
        </div>`}
      </div>

      <div class="ed-tabs tabs" role="tablist">
        ${TABS.map(([k, t]) => html`<button role="tab" aria-selected=${infoTab === k} class=${`${infoTab === k ? 'on' : ''} ${k === 'moves' ? 'only-narrow' : ''}`} onClick=${() => setTab(k)}>${t}</button>`)}
      </div>

      <div class=${`card ed-moves ${narrow && infoTab !== 'moves' ? 'off' : ''}`}>
        <${Tree} chapter=${chapter} path=${path.slice(0, trail.length)} select=${setPath} />
        ${node
          ? html`<div class="node-tools">
              <div class="row">
                <b>${moveLabel(trail.length > 1 ? trail[trail.length - 2].fen : chapter.startFen)}${de(node.san)}</b>
                ${GLYPHS.map(g => html`<button class=${`btn small glyph ${node.glyph === g ? 'on' : ''}`} onClick=${() => setGlyph(g)}>${g}</button>`)}
                <span class="sep"></span>
                ${POS.map(([g, t]) => html`<button class=${`btn small glyph ${node.pos === g ? 'on' : ''}`} title=${t} onClick=${() => setPos(g)}>${g}</button>`)}
              </div>
              <textarea rows=${node.comment ? Math.min(4, Math.max(2, Math.ceil(node.comment.length / 70))) : 1} placeholder="Kommentar zu diesem Zug …" value=${node.comment || ''} onInput=${e => setComment(e.target.value)}></textarea>
              <div class="row">
                <button class="link small" disabled=${path[trail.length - 1] === 0} onClick=${promote}>Zur Hauptvariante machen</button>
                <button class="link small danger" onClick=${removeNode}>Ab hier löschen</button>
              </div>
            </div>`
          : html`<p class="muted small">Spiele einen Zug auf dem Brett, um zu beginnen.</p>`}
      </div>

      <div class=${`card ed-info ${infoTab === 'moves' ? 'off' : ''}`}>
        <div class="ed-pane" hidden=${infoTab !== 'overview'}>
          <${OverviewPanel} fen=${fen} settings=${settings} setSettings=${setSettings} returnTo=${free ? { name: 'analyse' } : { name: 'edit', repId: w.id }} hits=${hits} hasRefs=${refReps.length > 0} active=${infoTab === 'overview'} onPlay=${playSan} />
        </div>
        <div class="ed-pane" hidden=${infoTab !== 'engine'}>
          <${EnginePanel} fen=${fen} enabled=${settings.engine} setEnabled=${v => setSettings({ engine: v })} lines=${Math.min(5, Math.max(1, settings.engineLines || 3))} setLines=${n => setSettings({ engineLines: n })} onPlayLine=${playLine} onBest=${setBest} orientation=${orient} />
        </div>
        <div class="ed-pane" hidden=${infoTab !== 'cloud'}>
          <${CloudPanel} fen=${fen} enabled=${settings.cloud} setEnabled=${v => setSettings({ cloud: v })} onEval=${setCloudEval} onPlay=${playSan} />
        </div>
        <div class="ed-pane" hidden=${infoTab !== 'db'}>
          <${ExplorerPanel} fen=${fen} settings=${settings} setSettings=${setSettings} returnTo=${free ? { name: 'analyse' } : { name: 'edit', repId: w.id }} onPlay=${playSan} />
        </div>
        ${refs.length > 0 && html`<div class="ed-pane" hidden=${infoTab !== 'refs'}>
          <${RefPanel} refs=${refs} refOff=${refOff} setRefOff=${v => setSettings({ refOff: v })} hits=${hits} fen=${fen} known=${known} lastText=${lastText} onPlay=${playSan} />
        </div>`}
        <div class="ed-pane" hidden=${infoTab !== 'games'}>
          <${ModelGamesPanel} fen=${fen} token=${settings.lichessToken} orientation=${orient} active=${infoTab === 'games'} />
        </div>
      </div>
    </div>
  </div>`;
}

/** Zugbaum im PGN-Stil: Hauptvariante fortlaufend, Nebenvarianten in Klammern. */
function Tree({ chapter, path, select }) {
  const current = path.join('.');
  const ref = useRef(null);
  const [fold, setFold] = useState({ all: false, flips: new Set() });
  const isFolded = key => fold.all !== fold.flips.has(key) && current !== key && !current.startsWith(key + '.');
  const toggle = key =>
    setFold(f => {
      const flips = new Set(f.flips);
      if (!flips.delete(key)) flips.add(key);
      return { ...f, flips };
    });
  let hasVar = false;
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('.mv.cur');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const moveEl = (n, p, fenBefore, forceLabel) => {
    const label = moveLabel(fenBefore);
    const key = p.join('.');
    return html`<span class=${`mv ${key === current ? 'cur' : ''}`} onClick=${() => select(p)}>
        ${(forceLabel || whiteLabel(label)) && html`<span class="no">${label}</span>`}${de(n.san)}${n.glyph && html`<span class="gl">${n.glyph}</span>`}${n.pos && html`<span class="gl"> ${n.pos}</span>`}
      </span>
      ${n.comment && html`<span class="cmi">${n.comment}</span>`}`;
  };

  const sequence = (siblings, parentPath, fenBefore, force) => {
    const out = [];
    while (siblings.length) {
      const main = siblings[0];
      const mainPath = [...parentPath, 0];
      out.push(moveEl(main, mainPath, fenBefore, force));
      force = annotated(main);
      for (let i = 1; i < siblings.length; i++) {
        const v = siblings[i];
        const vp = [...parentPath, i];
        const key = vp.join('.');
        hasVar = true;
        out.push(
          isFolded(key)
            ? html`<span class="var">(<span class="fold" onClick=${() => toggle(key)} title="Variante ausklappen">▸</span>${moveEl(v, vp, fenBefore, true)}${v.children.length > 0 && ' …'})</span>`
            : html`<span class="var">(<span class="fold" onClick=${() => toggle(key)} title="Variante einklappen">▾</span>${moveEl(v, vp, fenBefore, true)}${sequence(v.children, vp, v.fen, annotated(v))})</span>`,
        );
        force = true;
      }
      parentPath = mainPath;
      fenBefore = main.fen;
      siblings = main.children;
    }
    return out;
  };

  const items = sequence(chapter.children, [], chapter.startFen, true);
  return html`<div class="tree-wrap">
    <div class="tree" ref=${ref}>${items.length ? items : html`<span class="muted">Noch keine Züge.</span>`}</div>
    ${hasVar && html`<button class="link small" onClick=${() => setFold({ all: !fold.all, flips: new Set() })}>${fold.all ? 'Alle Varianten ausklappen' : 'Alle Varianten einklappen'}</button>`}
  </div>`;
}

/** Bewertungsbalken neben dem Brett (Stockfish, sonst ChessDB). */
function EvalBar({ ev, whiteBelow }) {
  let share = 50;
  let text = '';
  if (ev) {
    if (ev.mate != null) {
      share = ev.mate > 0 ? 100 : 0;
      text = `#${Math.abs(ev.mate)}`;
    } else {
      share = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ev.cp)) - 1);
      text = Math.abs(ev.cp) > 15000 ? '#' : (Math.abs(ev.cp) / 100).toFixed(1);
    }
  }
  const whiteAhead = share >= 50;
  return html`<div class=${`evalbar ${whiteBelow ? '' : 'flip'}`} title="Stellungsbewertung (Stockfish, sonst ChessDB)">
    <div class="white" style=${{ height: `${share}%` }}></div>
    ${ev && html`<span class=${`${whiteAhead ? 'w' : 'b'} ${whiteAhead === whiteBelow ? 'low' : 'high'}`}>${text}</span>`}
  </div>`;
}

/** Neues Kapitel: leer, ab einer Stellung (FEN) oder aus PGN-Text. */
/** FEN-Zeile unter dem Brett: aktuelle Stellung zum Kopieren, eingefügte FEN laden. */
function FenRow({ fen, free, onLoad }) {
  const [text, setText] = useState(null); // null = zeigt die aktuelle Stellung
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const value = text === null ? fen : text;
  const load = () => {
    try {
      onLoad(value);
      setText(null);
      setError('');
    } catch {
      setError('Das ist keine gültige FEN.');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Kopieren nicht erlaubt: Text steht markierbar im Feld
    }
  };
  const editing = text !== null && text.trim() !== fen;
  return html`<div class="fen-row">
    <label class="fen-field small">FEN
      <input id="fen-input" type="text" spellcheck=${false} autocomplete="off" value=${value} onFocus=${e => e.target.select()}
        onInput=${e => { setText(e.target.value); setError(''); }} onKeyDown=${e => e.key === 'Enter' && editing && load()} />
    </label>
    ${editing
      ? html`<button class="btn small primary" onClick=${load} title=${free ? 'Diese Stellung auf das Brett stellen' : 'Neues Kapitel mit dieser Startstellung anlegen'}>${free ? 'Laden' : 'Als Kapitel'}</button>
          <button class="btn small ghost" onClick=${() => { setText(null); setError(''); }}>Abbrechen</button>`
      : html`<button class="btn small" onClick=${copy} title="Aktuelle Stellung als FEN kopieren">${copied ? 'Kopiert ✓' : 'Kopieren'}</button>`}
    ${error && html`<div class="msg bad small fen-error">${error}</div>`}
  </div>`;
}

function ChapterForm({ count, onAdd, onCancel }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const t = text.trim();
    const name = `Kapitel ${count + 1}`;
    if (!t) return onAdd([{ name, startFen: INITIAL_FEN, children: [] }]);
    try {
      return onAdd([{ name, startFen: makeFen(posFromFen(t).toSetup()), children: [] }]);
    } catch {
      // keine FEN, dann als PGN versuchen
    }
    let chapters = [];
    try {
      chapters = parseRepertoirePgn(t);
    } catch {
      chapters = [];
    }
    if (chapters.length) return onAdd(chapters);
    setError('Das ist weder eine gültige FEN noch eine PGN mit Zügen.');
  };
  return html`<div class="node-tools">
    <textarea rows="3" placeholder="Leer lassen für ein leeres Kapitel – oder FEN (Startstellung) bzw. PGN-Text einfügen" value=${text} onInput=${e => setText(e.target.value)}></textarea>
    ${error && html`<div class="msg bad">${error}</div>`}
    <div class="row">
      <button class="btn small primary" onClick=${add}>Kapitel anlegen</button>
      <button class="btn small ghost" onClick=${onCancel}>Abbrechen</button>
    </div>
  </div>`;
}

/** Variante der Engine als Liste: Text ("4.Sxe5" bzw. "d5"), Stellung nach dem Zug, Felder für die Markierung. */
function pvPlies(fen, pv) {
  const pos = posFromFen(fen);
  const out = [];
  for (const uci of pv) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    const label = moveLabel(makeFen(pos.toSetup()));
    const last = moveKeys(pos, move);
    const san = makeSanAndPlay(pos, move);
    out.push({ text: de(whiteLabel(label) || !out.length ? `${label}${san}` : san), fen: makeFen(pos.toSetup()), last });
  }
  return out;
}

const NO_HOVER = '(hover: none)';

/** Lage des Vorschau-Bretts: über dem Zug, wenn dort Platz ist, sonst darunter; nie aus dem Fenster heraus. */
function peekStyle(p) {
  const size = 236;
  const h = size + (p.take ? 60 : 0);
  const left = Math.max(8, Math.min(innerWidth - size - 8, p.x - size / 2));
  const top = p.y - h - 8 >= 8 ? p.y - h - 8 : Math.min(innerHeight - h - 8, p.bottom + 8);
  return { left: `${left}px`, top: `${Math.max(8, top)}px`, width: `${size}px` };
}

function EnginePanel({ fen, enabled, setEnabled, lines, setLines, onPlayLine, onBest, orientation }) {
  const [info, setInfo] = useState(null);
  const [wide, setWide] = useState(-1); // aufgeklappte Variante
  const [peek, setPeek] = useState(null); // Vorschau: { fen, last, x, y, take?: [uci] }
  const touch = matchMedia(NO_HOVER).matches;
  useEffect(() => setPeek(null), [fen]);
  const [error, setError] = useState('');
  const eng = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      eng.current = new StockfishEngine(setInfo, { multiPv: lines });
    } catch (err) {
      setError('Stockfish konnte nicht gestartet werden.');
      return;
    }
    eng.current.worker.onerror = () => setError('Stockfish konnte nicht geladen werden.');
    return () => {
      eng.current.destroy();
      eng.current = null;
      setInfo(null);
      onBest(null);
    };
  }, [enabled, lines]);

  useEffect(() => {
    if (enabled && eng.current) eng.current.analyse(fen);
  }, [fen, enabled, lines]);

  const fresh = info && info.fen === fen ? info : null;
  useEffect(() => {
    const first = fresh && fresh.lines[0];
    if (!first) return onBest(null);
    const pos = posFromFen(fen);
    const move = parseUci(first.pv[0]);
    if (!move || !pos.isLegal(move)) return onBest(null);
    const [from, to] = moveKeys(pos, move);
    onBest({ fen, from, to, cp: first.cp, mate: first.mate });
  }, [fresh && fresh.lines[0] && fresh.lines[0].pv[0], fresh && fresh.lines[0] && fresh.lines[0].cp, fresh && fresh.lines[0] && fresh.lines[0].mate, fen]);

  return html`<div class="card">
    <div class="row between">
      <h3 class="flat">Stockfish 19 ${fresh && html`<span class="muted small" title=${eng.current && eng.current.threads > 1 ? 'Stockfish rechnet auf mehreren Prozessorkernen gleichzeitig' : 'Dieser Browser erlaubt Stockfish hier nur einen Prozessorkern'}>Tiefe ${fresh.depth} · ${eng.current && eng.current.threads > 1 ? `${eng.current.threads} Kerne` : '1 Kern'}</span>`}</h3>
      <span class="row">
        ${enabled && html`<label class="inline small" title="Wie viele Varianten Stockfish gleichzeitig zeigt">Varianten
          <select class="auto" value=${lines} onChange=${e => setLines(+e.target.value)}>${[1, 2, 3, 4, 5].map(n => html`<option value=${n}>${n}</option>`)}</select>
        </label>`}
        <label class="check"><input type="checkbox" checked=${enabled} onChange=${e => setEnabled(e.target.checked)} /> an</label>
      </span>
    </div>
    ${error && html`<div class="msg bad">${error}</div>`}
    ${enabled && !error && html`<div class="pvs">
      ${fresh
        ? fresh.lines.map((l, li) => {
            const plies = pvPlies(fen, l.pv);
            // Maus: Vorschau beim Überfahren, Klick übernimmt bis zu diesem Zug. Finger: Antippen zeigt Vorschau mit Knopf.
            const show = (ev, p, i, take) => {
              const r = ev.currentTarget.getBoundingClientRect();
              setPeek({ fen: p.fen, last: p.last, x: r.left + r.width / 2, y: r.top, bottom: r.bottom, take: take ? l.pv.slice(0, i + 1) : null });
            };
            return html`<div class=${`pv ${wide === li ? 'open' : ''}`} key=${li}>
              <b class=${(l.mate != null ? l.mate : l.cp) >= 0 ? 'ev w' : 'ev b'}>${formatScore(l)}</b>
              <span class="pv-moves">
                ${plies.map((p, i) => html`<span class="pvm" title=${touch ? '' : 'Variante bis zu diesem Zug übernehmen'}
                  onMouseEnter=${touch ? null : ev => show(ev, p, i, false)} onMouseLeave=${touch ? null : () => setPeek(null)}
                  onClick=${ev => (touch ? show(ev, p, i, true) : (setPeek(null), onPlayLine(l.pv.slice(0, i + 1))))}>${p.text}</span>${' '}`)}
              </span>
              <button class="pv-more" onClick=${() => setWide(wide === li ? -1 : li)} title=${wide === li ? 'Variante einklappen' : 'Ganze Variante zeigen'} aria-expanded=${wide === li}>${wide === li ? '▴' : '▾'}</button>
            </div>`;
          })
        : html`<span class="muted small">rechnet …</span>`}
      ${fresh && html`<div class="muted small pv-help">${touch ? 'Zug antippen: Vorschau der Stellung, dann übernehmen.' : 'Maus über einen Zug: Vorschau. Klick: Variante bis dorthin übernehmen.'}</div>`}
    </div>`}
    ${peek && html`<div class=${`pv-peek ${peek.take ? 'tap' : ''}`} style=${peekStyle(peek)}>
      <${Board} key=${peek.fen} orientation=${orientation} fen=${peek.fen} lastMove=${peek.last} />
      ${peek.take && html`<div class="row">
        <button class="btn primary small" onClick=${() => { const t = peek.take; setPeek(null); onPlayLine(t); }}>Bis hier übernehmen</button>
        <button class="btn ghost small" onClick=${() => setPeek(null)}>Schließen</button>
      </div>`}
    </div>`}
  </div>`;
}

// Hat nichts mit der eigenen Anmeldung zu tun: der Server der Lichess-Eröffnungsdatenbank antwortet nicht
const LICHESS_DOWN = 'Die Eröffnungsdatenbank von Lichess antwortet gerade nicht. Das liegt am Lichess-Server, nicht an deiner Anmeldung. Bitte später noch einmal versuchen.';

/** Reiter „Repertoires“: Züge aus den eigenen Repertoires in dieser Stellung, mit Kapitel und Kommentar. */
function RefPanel({ refs, refOff, setRefOff, hits, fen, known, lastText, onPlay }) {
  const active = refs.filter(r => !refOff[r.id]);
  const toggle = (id, on) => {
    const next = { ...refOff };
    if (on) delete next[id];
    else next[id] = true;
    setRefOff(next);
  };
  const short = t => (t.length > 220 ? t.slice(0, 210).trimEnd() + ' …' : t);
  return html`<div class="card stack tight ref-panel">
    <h3 class="flat">Züge aus deinen Repertoires</h3>
    ${!active.length
      ? html`<p class="muted small">Kein Repertoire ausgewählt.</p>`
      : hits.length
        ? hits.map(h => html`<div class="ref-rep">
            <div><b>${h.rep.name}</b>${authorOf(h.rep) && html`<span class="muted small"> · ${authorOf(h.rep)}</span>`}</div>
            ${h.moves.length
              ? h.moves.map(m => html`<div class="ref-row">
                  <button class=${`btn small ${m.main && m.own ? 'primary' : ''}`} onClick=${() => onPlay(m.san)} title="Zug spielen">${moveText(fen, m.san)}</button>
                  <div class="small">
                    <span class=${m.main && m.own ? '' : 'muted'}>${!m.own ? 'Gegnerzug im Repertoire' : m.main ? 'Hauptzug' : 'Nebenvariante'}</span>
                    <span class="muted"> · Kapitel „${m.chapter}“</span>
                    ${m.comment && html`<div class="muted ref-comment">„${short(m.comment)}“</div>`}
                  </div>
                </div>`)
              : html`<div class="muted small">Hier endet die Variante (Kapitel „${h.end}“).</div>`}
          </div>`)
        : html`<p class="muted small">${known >= 0 ? `Diese Stellung steht in keinem ausgewählten Repertoire. Zuletzt im Repertoire ${lastText}.` : 'Diese Stellung steht in keinem ausgewählten Repertoire.'}</p>`}
    <details class="ref-choose">
      <summary class="small">Welche Repertoires? (${active.length} von ${refs.length})</summary>
      <div class="stack tight">
        ${refs.map(r => html`<label class="check small"><input type="checkbox" checked=${!refOff[r.id]} onChange=${e => toggle(r.id, e.target.checked)} /> ${r.name}${authorOf(r) ? ` · ${authorOf(r)}` : ''} <span class="muted">(${r.color === 'white' ? 'Weiß' : 'Schwarz'})</span></label>`)}
      </div>
    </details>
  </div>`;
}

/**
 * Übersicht: Datenbank (Lichess, wenn angemeldet), Cloud-Bewertung (wenn eingeschaltet) und Repertoire-Züge
 * in einer Tabelle, eine Zeile pro Zug. Klick auf eine Zeile spielt den Zug.
 */
function OverviewPanel({ fen, settings, setSettings, returnTo, hits, hasRefs, active, onPlay }) {
  const token = settings.lichessToken;
  const preset = settings.explorer;
  const cloudOn = !!settings.cloud;
  const [db, setDb] = useState({ fen: null, data: null, error: '' });
  const [cloud, setCloud] = useState({ fen: null, data: null, error: '' });

  useEffect(() => {
    if (!token || !active) return;
    let live = true;
    const t = setTimeout(() => {
      explore(fen, preset, token)
        .then(data => live && setDb({ fen, data, error: '' }))
        .catch(err => {
          if (!live) return;
          if (err.auth) setSettings({ lichessToken: null });
          setDb({ fen, data: null, error: err.auth ? '' : err instanceof TypeError ? LICHESS_DOWN : err.message });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, preset, token, active]);

  useEffect(() => {
    if (!cloudOn || !active) return;
    let live = true;
    const t = setTimeout(() => {
      cdbMoves(fen)
        .then(data => live && setCloud({ fen, data, error: '' }))
        .catch(err => live && setCloud({ fen, data: null, error: err instanceof TypeError ? 'Keine Verbindung zu ChessDB.' : err.message }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, cloudOn, active]);

  const d = token && db.fen === fen ? db.data : null;
  const c = cloudOn && cloud.fen === fen && cloud.data && cloud.data.status === 'ok' ? cloud.data : null;
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.' : n >= 1e4 ? Math.round(n / 1e3) + ' Tsd.' : n.toLocaleString('de-DE'));

  // Zeilen zusammenführen: Datenbank-Züge (nach Häufigkeit), dann Cloud-Züge, dann Repertoire-Züge
  const rows = new Map();
  const row = san => {
    if (!rows.has(san)) rows.set(san, { san, games: null, cloud: null, reps: [] });
    return rows.get(san);
  };
  const total = d ? d.white + d.draws + d.black : 0;
  if (d) for (const m of d.moves) row(m.san).games = m;
  if (c) {
    const extra = Math.max(3, 10 - rows.size);
    let added = 0;
    for (const m of c.moves) {
      if (rows.has(m.san)) rows.get(m.san).cloud = m;
      else if (added < extra) {
        row(m.san).cloud = m;
        added++;
      }
    }
  }
  for (const h of hits) for (const m of h.moves) row(m.san).reps.push({ name: h.rep.name, main: m.main && m.own });
  const list = [...rows.values()];
  const loadingDb = token && active && db.fen !== fen;
  const loadingCloud = cloudOn && active && cloud.fen !== fen;

  return html`<div class="card stack tight overview">
    <div class="row between">
      <h3 class="flat">Übersicht ${d && d.opening ? html`<span class="muted small">${d.opening.eco} ${d.opening.name}</span>` : ''}</h3>
      <span class="row">
        ${token && html`<select class="auto small" value=${preset} onChange=${e => setSettings({ explorer: e.target.value })} title="Welche Partien gezählt werden">
          ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}
        </select>`}
        <label class="check small" title="Computer-Bewertungen von chessdb.cn (Stellung und IP-Adresse gehen an Server in China)"><input type="checkbox" checked=${cloudOn} onChange=${e => setSettings({ cloud: e.target.checked })} /> Cloud</label>
      </span>
    </div>
    ${db.error && token && html`<div class="msg bad small">${db.error}</div>`}
    ${cloud.error && cloudOn && html`<div class="msg bad small">${cloud.error}</div>`}
    ${list.length > 0
      ? html`<table class="table explorer ov-table">
          <thead><tr>
            <th>Zug</th>
            ${token && html`<th class="right">Partien</th>`}
            ${token && html`<th class="wide">Ergebnis</th>`}
            ${cloudOn && html`<th class="right">Cloud</th>`}
            ${hasRefs && html`<th>Repertoire</th>`}
          </tr></thead>
          <tbody>
            ${list.map(r => {
              const g = r.games;
              const n = g ? g.white + g.draws + g.black : 0;
              const p = x => `${(x / n) * 100}%`;
              return html`<tr onClick=${() => onPlay(r.san)} title="Zug spielen">
                <td><b>${moveText(fen, r.san)}</b></td>
                ${token && html`<td class="right muted" title=${g && total ? `${Math.round((n / total) * 100)} % der Partien` : ''}>${g ? fmt(n) : '–'}</td>`}
                ${token && html`<td class="wide">${g ? html`<div class="wdlbar"><i class="w" style=${{ width: p(g.white) }}>${Math.round((g.white / n) * 100)}</i><i class="d" style=${{ width: p(g.draws) }}></i><i class="b" style=${{ width: p(g.black) }}>${Math.round((g.black / n) * 100)}</i></div>` : ''}</td>`}
                ${cloudOn && html`<td class="right">${r.cloud ? html`<b class=${r.cloud.cp >= 0 ? 'ev w' : 'ev b'}>${formatCloud(r.cloud.cp)}</b>` : html`<span class="muted">–</span>`}</td>`}
                ${hasRefs && html`<td class="ov-rep small">${r.reps.map((x, i) => html`${i ? ', ' : ''}<span class=${x.main ? '' : 'muted'} title=${x.main ? 'Hauptzug' : ''}>✓ ${x.name}</span>`)}</td>`}
              </tr>`;
            })}
          </tbody>
        </table>`
      : !loadingDb && !loadingCloud && html`<p class="muted small">${token || cloudOn || hasRefs ? 'Zu dieser Stellung gibt es keine Angaben.' : 'Schalte die Cloud-Bewertung ein oder melde dich bei Lichess an, um hier Züge zu sehen.'}</p>`}
    ${(loadingDb || loadingCloud) && html`<span class="muted small">lädt …</span>`}
    ${!token && html`<p class="muted small">Partien aus der Lichess-Datenbank gibt es nur mit Lichess-Anmeldung.${' '}<button class="link" onClick=${() => startLogin(returnTo)}>Mit Lichess anmelden</button></p>`}
    ${!cloudOn && html`<p class="muted small">Cloud-Bewertung ist aus. Beim Einschalten gehen die Stellung und deine IP-Adresse an chessdb.cn (Server in China).</p>`}
  </div>`;
}

function ExplorerPanel({ fen, settings, setSettings, returnTo, onPlay }) {
  const [state, setState] = useState({ data: null, error: '', loading: false });
  const token = settings.lichessToken;
  const preset = settings.explorer;

  useEffect(() => {
    if (!token) return;
    let live = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    const t = setTimeout(() => {
      explore(fen, preset, token)
        .then(data => live && setState({ data, error: '', loading: false }))
        .catch(err => {
          if (!live) return;
          if (err.auth) setSettings({ lichessToken: null });
          setState({ data: null, error: err.auth ? '' : err instanceof TypeError ? LICHESS_DOWN : err.message, loading: false });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, preset, token]);

  const d = state.data;
  const total = d ? d.white + d.draws + d.black : 0;
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mio.' : n >= 1e4 ? Math.round(n / 1e3) + ' Tsd.' : String(n));

  return html`<div class="card">
    <div class="row between">
      <h3 class="flat">Eröffnungsdatenbank</h3>
      ${token && html`<select class="auto" value=${preset} onChange=${e => setSettings({ explorer: e.target.value })}>
        ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}
      </select>`}
    </div>
    ${!token
      ? html`<p class="muted small">Lichess gibt seine Partiendatenbank nur für angemeldete Nutzer frei. Die Anmeldung läuft direkt bei Lichess; der Zugtrainer erhält keine Rechte auf deinem Konto.</p>
          <button class="btn primary" onClick=${() => startLogin(returnTo)}>Mit Lichess anmelden</button>`
      : html`
        ${state.error && html`<div class="msg bad">${state.error}</div>`}
        ${d && d.opening && html`<div class="muted small">${d.opening.eco} ${d.opening.name}</div>`}
        ${d && (d.moves.length
          ? html`<table class="table explorer">
              <tbody>
                ${d.moves.map(m => {
                  const n = m.white + m.draws + m.black;
                  const p = x => `${(x / n) * 100}%`;
                  return html`<tr onClick=${() => onPlay(m.san)} title="Zug übernehmen">
                    <td><b>${de(m.san)}</b></td>
                    <td class="right muted">${total ? Math.round((n / total) * 100) : 0} %</td>
                    <td class="right muted">${fmt(n)}</td>
                    <td class="wide"><div class="wdlbar"><i class="w" style=${{ width: p(m.white) }}>${Math.round((m.white / n) * 100)}</i><i class="d" style=${{ width: p(m.draws) }}></i><i class="b" style=${{ width: p(m.black) }}>${Math.round((m.black / n) * 100)}</i></div></td>
                  </tr>`;
                })}
              </tbody>
            </table>`
          : html`<div class="muted small">Keine Partien mit dieser Stellung.</div>`)}
        ${state.loading && !d && html`<span class="muted small">lädt …</span>`}
        <button class="link small" onClick=${() => setSettings({ lichessToken: null })}>Von Lichess abmelden</button>`}
  </div>`;
}

/** Cloud-Bewertungen aus der Chess Cloud Database (chessdb.cn). */
function CloudPanel({ fen, enabled, setEnabled, onPlay, onEval }) {
  const [state, setState] = useState({ fen: null, data: null, error: '', queued: false });
  const [tick, reload] = useReducer(x => x + 1, 0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const t = setTimeout(() => {
      cdbMoves(fen)
        .then(data => live && setState({ fen, data, error: '', queued: false }))
        .catch(err => live && setState({ fen, data: null, error: err instanceof TypeError ? 'Keine Verbindung zu ChessDB.' : err.message, queued: false }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, enabled, tick]);

  const cur = state.fen === fen ? state : null;
  const d = cur && cur.data;
  const top = enabled && d && d.status === 'ok' && d.moves.length ? d.moves[0].cp : null;
  useEffect(() => {
    if (onEval) onEval(top != null ? { fen, cp: top } : null);
  }, [top, fen]);
  const queue = () => cdbQueue(fen).then(() => setState(s => ({ ...s, queued: true }))).catch(() => {});
  const TAG = { 2: 'bester Zug', 1: 'gut', 0: 'schwächer' };

  return html`<div class="card">
    <div class="row between">
      <h3 class="flat">Cloud-Bewertung <span class="muted small">ChessDB</span></h3>
      <label class="check"><input type="checkbox" checked=${enabled} onChange=${e => setEnabled(e.target.checked)} /> an</label>
    </div>
    ${!enabled && html`<p class="muted small">Zeigt Computer-Bewertungen für die aktuelle Stellung. Beim Einschalten werden die Stellung und deine IP-Adresse an den Dienst chessdb.cn gesendet (Server in China).</p>`}
    ${enabled && html`
      ${cur && cur.error && html`<div class="msg bad">${cur.error}</div>`}
      ${!cur && html`<span class="muted small">lädt …</span>`}
      ${d && d.status === 'ok' && html`<table class="table explorer cloud">
        <tbody>
          ${d.moves.slice(0, 8).map(m => html`<tr onClick=${() => onPlay(m.san)} title="Zug übernehmen">
            <td><b>${moveText(fen, m.san)}</b></td>
            <td><b class=${m.cp >= 0 ? 'ev w' : 'ev b'}>${formatCloud(m.cp)}</b></td>
            <td class=${`small rank${m.rank}`}>${TAG[m.rank] || ''}</td>
          </tr>`)}
        </tbody>
      </table>`}
      ${d && d.status === 'unknown' && html`<div class="muted small">
        Diese Stellung kennt ChessDB noch nicht.${' '}
        ${cur.queued
          ? html`Analyse angefordert – <button class="link" onClick=${reload}>erneut abrufen</button>`
          : html`<button class="link" onClick=${queue}>Analyse anfordern</button>`}
      </div>`}
      ${d && (d.status === 'checkmate' || d.status === 'stalemate') && html`<div class="muted small">Partie ist hier zu Ende.</div>`}
      <details class="muted small source-info">
        <summary>Woher kommen diese Zahlen?</summary>
        Aus der Chess Cloud Database (<a href="https://www.chessdb.cn/queryc_en/" target="_blank" rel="noopener">chessdb.cn</a>), einer öffentlichen Sammlung
        vorab berechneter Stockfish-Bewertungen. Die Zahl ist die Bewertung in Bauerneinheiten aus Sicht von Weiß (+ = Weiß steht besser).
        Die Werte sind oft tiefer gerechnet als das Stockfish hier im Browser, aber nicht für jede Stellung vorhanden.
      </details>
      ${d && d.status === 'invalid board' && html`<div class="muted small">ChessDB kann diese Stellung nicht auswerten.</div>`}
    `}
  </div>`;
}

const pct = x => (x >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1).replace('.', ',')) + ' %';

/** Abdeckung: häufige Gegnerzüge, die im Repertoire fehlen. */
const coverCache = new Map(); // Repertoire -> letztes Ergebnis (bis zum Neuladen der Seite)

/** Fehlende Gegnerzüge finden: Welche häufigen Gegnerzüge fehlen im Repertoire? (Seite „Lücken finden“, Reiter „Aus der Datenbank“) */
export function CoveragePanel({ rep, settings, setSettings, onJump }) {
  const [run, setRun] = useState(null); // { checked } während der Prüfung
  const [res, setResState] = useState(() => coverCache.get(rep.id) || null);
  const setRes = r => {
    if (r) coverCache.set(rep.id, r);
    else coverCache.delete(rep.id);
    setResState(r);
  };
  const abort = useRef(null);
  useEffect(() => () => abort.current && abort.current.abort(), []);
  const token = settings.lichessToken;
  // Eigene Spielstärke für diese Prüfung (nicht die Einstellung des Analyse-Bretts); vorgewählt: alle Spielstärken
  const presetKey = PRESETS[settings.coverDb] ? settings.coverDb : 'all';
  const min = settings.coverMin || 0.01;

  const start = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setRes(null);
    setRun({ checked: 0, wait: 0 });
    const r = await scanCoverage(rep, {
      preset: presetKey,
      token,
      min,
      signal: ctl.signal,
      onProgress: checked => setRun(s => ({ ...s, checked, wait: 0 })),
      onWait: wait => setRun(s => ({ ...(s || { checked: 0 }), wait })),
    });
    setRes(ctl.signal.aborted && !r.gaps.length ? null : r);
    setRun(null);
  };

  const row = g => html`<button class="item" onClick=${() => onJump(g.ci, g.path)} title="Diese Stelle im Editor öffnen">
    <span class="count">${pct(g.inc)}</span>
    <span class="grow small">
      ${g.type === 'answer'
        ? html`Nach <b>${de(lineText(rep, g.ci, g.path)) || 'der Grundstellung'}</b> hast du keinen Zug.`
        : html`<b>${moveLabel(g.fen)}${de(g.san)}</b> <span class="muted">nach ${de(lineText(rep, g.ci, g.path)) || 'der Grundstellung'} · spielen dort ${pct(g.share)}</span>`}
    </span>
  </button>`;

  const missing = res ? res.gaps.filter(g => g.type !== 'end') : [];
  const ends = res ? res.gaps.filter(g => g.type === 'end') : [];

  return html`<div class="card" id="coverage-panel">
    <h2 class="flat">Fehlende Gegnerzüge finden</h2>
    <p class="muted small">Geht dein Repertoire vom ersten Zug an durch und fragt die Lichess-Datenbank, was Gegner in deinen Stellungen spielen. Gemeldet werden Züge, die oft genug vorkommen, aber in deinem Repertoire fehlen. Seltene Stellungen werden gar nicht erst geprüft, deshalb sind es meist nur einige Dutzend Stellungen.</p>
    <div class="grid2 cover-opts">
      <label class="small">Spielstärke der Gegner
        <select value=${presetKey} disabled=${!!run} onChange=${e => setSettings({ coverDb: e.target.value })}>
          ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.label.replace(/^Lichess – /, '')}</option>`)}
        </select>
      </label>
      <label class="small">Melden, wenn der Zug vorkommt in mindestens
        <select value=${min} disabled=${!!run} onChange=${e => setSettings({ coverMin: +e.target.value })}>
          ${[[0.05, 20, '5 %'], [0.02, 50, '2 %'], [0.01, 100, '1 %'], [0.005, 200, '0,5 %']].map(([v, k, t]) => html`<option value=${v}>1 von ${k} Partien (${t})</option>`)}
        </select>
      </label>
    </div>
    <p class="muted small">Je seltener die Schwelle, desto gründlicher, aber desto länger dauert die Prüfung. 1 von 100 ist für ein ernsthaftes Repertoire eine gute Grenze.</p>
    ${!token
      ? html`<div class="muted small">Dafür ist die Lichess-Anmeldung nötig. Lichess gibt seine Partiendatenbank nur für angemeldete Nutzer frei.</div>
          <div class="row"><button class="btn primary" onClick=${() => startLogin({ name: 'rep', repId: rep.id })}>Mit Lichess anmelden</button></div>`
      : run
        ? html`<div class="stack tight">
            <div class="progress busy"><div></div></div>
            <div class="row between">
              <span class="muted small">${run.wait ? `Lichess bremst kurz, es geht in ${run.wait} s weiter … (${run.checked} Stellungen geprüft)` : `${run.checked} Stellungen geprüft …`}</span>
              <button class="btn small" onClick=${() => abort.current.abort()}>Abbrechen</button>
            </div>
          </div>`
        : html`<button class="btn primary" onClick=${start}>${res ? 'Erneut prüfen' : 'Fehlende Gegnerzüge finden'}</button>`}
    ${res && html`
      ${res.error && html`<div class="msg bad">${res.error}</div>`}
      ${res.truncated && html`<div class="muted small">Nach ${res.checked} Stellungen gestoppt – die wichtigsten Lücken stehen unten.</div>`}
      ${!res.gaps.length && !res.error && html`<div class="muted small">Keine Lücken über der Schwelle gefunden (${res.checked} Stellungen geprüft).</div>`}
      ${missing.length > 0 && html`<div class="eyebrow">Fehlende Gegnerzüge (${missing.length})</div><div class="list cover">${missing.map(row)}</div>`}
      ${ends.length > 0 && html`<div class="eyebrow">Variante endet, Gegner spielt weiter (${ends.length})</div><div class="list cover">${ends.map(row)}</div>`}
    `}
  </div>`;
}

const RESULT = { white: '1-0', black: '0-1' };

/** Meisterpartien mit der aktuellen Stellung, zum Durchspielen. */
function ModelGamesPanel({ fen, token, orientation, active }) {
  const open = active;
  const [state, setState] = useState({ fen: null, games: null, error: '' });
  const [view, setView] = useState(null); // { pgn, game }
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open || !token) return;
    let live = true;
    const t = setTimeout(() => {
      masterGames(fen, token)
        .then(games => live && setState({ fen, games, error: '' }))
        .catch(err => live && setState({ fen, games: null, error: err instanceof TypeError ? LICHESS_DOWN : err.message }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fen, open, token]);

  const show = async g => {
    setBusy(g.id);
    try {
      setView({ pgn: await masterPgn(g.id, token), game: g });
    } catch (err) {
      setState(s => ({ ...s, error: 'Die Partie konnte nicht geladen werden.' }));
    }
    setBusy(null);
  };

  const cur = state.fen === fen ? state : null;
  return html`<div class="card">
    <div class="row between">
      <h3 class="flat">Musterpartien <span class="muted small">Meisterpartien mit dieser Stellung</span></h3>
    </div>
    ${open && (!token
      ? html`<div class="muted small">Dafür ist die Lichess-Anmeldung nötig (siehe Reiter „Datenbank“).</div>`
      : html`
        ${cur && cur.error && html`<div class="msg bad">${cur.error}</div>`}
        ${!cur && html`<span class="muted small">lädt …</span>`}
        ${cur && cur.games && (cur.games.length
          ? html`<div class="list cover">
              ${cur.games.map(g => html`<button class="item" disabled=${busy === g.id} onClick=${() => show(g)}>
                <span class="grow small"><b>${g.white.name}</b> <span class="muted">${g.white.rating}</span> – <b>${g.black.name}</b> <span class="muted">${g.black.rating}</span></span>
                <span class="small muted">${RESULT[g.winner] || '½-½'} · ${g.year}</span>
              </button>`)}
            </div>`
          : html`<div class="muted small">Keine Meisterpartien mit dieser Stellung.</div>`)}
      `)}
    ${view && html`<${GameViewer} pgn=${view.pgn} game=${view.game} fen=${fen} orientation=${orientation} onClose=${() => setView(null)} />`}
  </div>`;
}

function mainline(pgn) {
  const game = parsePgn(pgn)[0];
  if (!game) return [];
  const pos = startingPosition(game.headers).unwrap();
  const plies = [{ fen: makeFen(pos.toSetup()) }];
  for (const d of game.moves.mainline()) {
    const move = parseSan(pos, d.san);
    if (!move) break;
    const label = moveLabel(makeFen(pos.toSetup()));
    const last = moveKeys(pos, move);
    const san = makeSanAndPlay(pos, move);
    plies.push({ san, label, last, fen: makeFen(pos.toSetup()) });
  }
  return plies;
}

function GameViewer({ pgn, game, fen, orientation, onClose }) {
  const plies = useRef(null);
  if (!plies.current) plies.current = mainline(pgn);
  const list = plies.current;
  const [i, setI] = useState(() => Math.max(0, list.findIndex(p => epdOf(p.fen) === epdOf(fen))));
  const at = useRef(i);
  at.current = i;
  const box = useRef(null);

  useEffect(() => {
    const h = ev => {
      const n = at.current;
      if (ev.key === 'ArrowLeft') setI(Math.max(0, n - 1));
      else if (ev.key === 'ArrowRight') setI(Math.min(list.length - 1, n + 1));
      else if (ev.key === 'Escape') onClose();
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  useEffect(() => {
    const el = box.current && box.current.querySelector('.mv.cur');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [i]);

  const p = list[i] || { fen };
  return html`<div class="modal" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="modal-box">
      <div class="row between">
        <div><b>${game.white.name}</b> <span class="muted">${game.white.rating}</span> – <b>${game.black.name}</b> <span class="muted">${game.black.rating}</span>
          <span class="muted small"> · ${RESULT[game.winner] || '½-½'} · ${game.year}</span></div>
        <button class="btn ghost small" onClick=${onClose}>Schließen</button>
      </div>
      <div class="viewer">
        <div>
          <${Board} orientation=${orientation} fen=${p.fen} lastMove=${p.last} />
          <div class="row nav">
            <button class="btn small" onClick=${() => setI(0)}>⏮</button>
            <button class="btn small" onClick=${() => setI(Math.max(0, i - 1))}>◀</button>
            <button class="btn small" onClick=${() => setI(Math.min(list.length - 1, i + 1))}>▶</button>
            <button class="btn small" onClick=${() => setI(list.length - 1)}>⏭</button>
            <span class="muted small">← → blättern · Esc schließt</span>
          </div>
        </div>
        <div class="tree" ref=${box}>
          ${list.slice(1).map((m, k) => html`<span class=${`mv ${k + 1 === i ? 'cur' : ''}`} onClick=${() => setI(k + 1)}>
            ${(whiteLabel(m.label) || k === 0) && html`<span class="no">${m.label}</span>`}${de(m.san)}
          </span>`)}
        </div>
      </div>
    </div>
  </div>`;
}
