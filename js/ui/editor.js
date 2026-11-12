import { html, useEffect, useReducer, useRef, useState } from 'preact';
import { de } from '../lib/repertoire.js';
import { chessgroundDests } from 'chessops/compat.js';
import { INITIAL_FEN, makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { parseSquare, parseUci } from 'chessops/util.js';
import { moveKeys, moveLabel, posFromFen, turnOf } from '../lib/repertoire.js';
import { downloadPgn } from '../lib/pgnexport.js';
import { StockfishEngine, formatScore } from '../lib/engine.js';
import { PRESETS, explore, masterGames, masterPgn, startLogin } from '../lib/lichess.js';
import { cdbMoves, cdbQueue, formatCloud } from '../lib/chessdb.js';
import { lineText, scanCoverage } from '../lib/coverage.js';
import { parsePgn, startingPosition } from 'chessops/pgn.js';
import { epdOf, parseRepertoirePgn } from '../lib/repertoire.js';
import { Board } from './board.js';

const GLYPHS = ['!', '?', '!!', '??', '!?', '?!'];
const POS = [['=', 'ausgeglichen'], ['∞', 'unklar'], ['⩲', 'Weiß steht etwas besser'], ['⩱', 'Schwarz steht etwas besser'], ['±', 'Weiß steht besser'], ['∓', 'Schwarz steht besser'], ['+−', 'Weiß steht auf Gewinn'], ['−+', 'Schwarz steht auf Gewinn']];
const annotated = n => !!(n.comment || (n.shapes && n.shapes.length));

export function Editor({ rep, at, settings, setSettings, saveRep, onExit }) {
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
  const arrows = settings.varArrows !== false;
  const cg = useRef(null);
  const timer = useRef(null);

  // Änderungen am Arbeitsstand speichern (leicht verzögert, damit Tippen flüssig bleibt)
  const commit = () => {
    force();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRep({ ...w }), 400);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      saveRep({ ...w });
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
  const removeChapter = () => {
    if (w.chapters.length < 2 || !confirm(`Kapitel „${chapter.name}“ löschen?`)) return;
    w.chapters.splice(ci, 1);
    setCi(0);
    setPath([]);
    commit();
  };

  return html`<div class="editor">
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
        <button class="btn small" onClick=${() => setPath([])} title="Zum Anfang">⏮</button>
        <button class="btn small" onClick=${back} title="Zug zurück (←)">◀</button>
        <button class="btn small" onClick=${forward} title="Zug vor (→)">▶</button>
        <button class="btn small" onClick=${toEnd} title="Zum Ende">⏭</button>
        <button class="btn small" onClick=${() => setFlipped(!flipped)} title="Brett drehen (F)">⇅ Drehen</button>
        <label class="check small"><input type="checkbox" checked=${arrows} onChange=${e => setSettings({ varArrows: e.target.checked })} /> Repertoirezüge als Pfeile</label>
        <span class="muted small">Züge auf dem Brett ausführen · Pfeile mit Rechtsklick ziehen</span>
      </div>
    </div>

    <div class="editor-side">
      <div class="card">
        <div class="row between">
          <input class="title-input" type="text" value=${w.name} onInput=${e => { w.name = e.target.value || 'Repertoire'; commit(); }} />
          <button class="btn ghost small" onClick=${onExit}>Fertig</button>
        </div>
        <div class="row">
          <select class="auto" value=${w.color} onChange=${e => { w.color = e.target.value; commit(); }}>
            <option value="white">Repertoire für Weiß</option>
            <option value="black">Repertoire für Schwarz</option>
          </select>
          <button class="btn small" onClick=${() => downloadPgn(w)}>PGN exportieren</button>
        </div>
        <div class="row">
          <select class="grow" value=${ci} onChange=${e => { setCi(+e.target.value); setPath([]); }}>
            ${w.chapters.map((c, i) => html`<option value=${i}>${i + 1}. ${c.name}</option>`)}
          </select>
          <button class="btn small" onClick=${() => setAddOpen(!addOpen)}>+ Kapitel</button>
          <button class="btn small ghost" disabled=${w.chapters.length < 2} onClick=${removeChapter} title="Kapitel löschen">🗑</button>
        </div>
        ${addOpen && html`<${ChapterForm} count=${w.chapters.length} onAdd=${addChapters} onCancel=${() => setAddOpen(false)} />`}
        <label>Kapitelname
          <input type="text" value=${chapter.name} onInput=${e => { chapter.name = e.target.value || 'Kapitel'; commit(); }} />
        </label>

        <${Tree} chapter=${chapter} path=${path.slice(0, trail.length)} select=${setPath} />

        ${node
          ? html`<div class="node-tools">
              <div class="row">
                <b>${moveLabel(trail.length > 1 ? trail[trail.length - 2].fen : chapter.startFen)} ${de(node.san)}</b>
                ${GLYPHS.map(g => html`<button class=${`btn small glyph ${node.glyph === g ? 'on' : ''}`} onClick=${() => setGlyph(g)}>${g}</button>`)}
              </div>
              <div class="row">
                <span class="muted small">Stellung</span>
                ${POS.map(([g, t]) => html`<button class=${`btn small glyph ${node.pos === g ? 'on' : ''}`} title=${t} onClick=${() => setPos(g)}>${g}</button>`)}
              </div>
              <textarea rows="3" placeholder="Kommentar zu diesem Zug …" value=${node.comment || ''} onInput=${e => setComment(e.target.value)}></textarea>
              <div class="row">
                <button class="btn small" disabled=${path[trail.length - 1] === 0} onClick=${promote}>Zur Hauptvariante machen</button>
                <button class="btn small danger" onClick=${removeNode}>Ab hier löschen</button>
              </div>
            </div>`
          : html`<p class="muted small">Spiele einen Zug auf dem Brett, um zu beginnen. Ein zweiter Zug in derselben Stellung legt eine Variante an.</p>`}
      </div>

      <${EnginePanel} fen=${fen} enabled=${settings.engine} setEnabled=${v => setSettings({ engine: v })} onPlay=${uci => playMove(parseUci(uci))} onBest=${setBest} />
      <${CloudPanel} fen=${fen} enabled=${settings.cloud} setEnabled=${v => setSettings({ cloud: v })} onEval=${setCloudEval} onPlay=${san => playMove(parseSan(posFromFen(fen), san))} />
      <${ExplorerPanel} fen=${fen} settings=${settings} setSettings=${setSettings} repId=${w.id} onPlay=${san => playMove(parseSan(posFromFen(fen), san))} />
      <${ModelGamesPanel} fen=${fen} token=${settings.lichessToken} orientation=${orient} />
      <${CoveragePanel} rep=${w} settings=${settings} setSettings=${setSettings} onJump=${(c, p) => { setCi(c); setPath(p); }} />
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
        ${(forceLabel || label.endsWith('.')) && html`<span class="no">${label}</span>`}${de(n.san)}${n.glyph && html`<span class="gl">${n.glyph}</span>`}${n.pos && html`<span class="gl"> ${n.pos}</span>`}
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
  return html`<div>
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

function pvToSan(fen, pv, max = 8) {
  const pos = posFromFen(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    const label = moveLabel(makeFen(pos.toSetup()));
    const san = makeSanAndPlay(pos, move);
    out.push(label.endsWith('.') || !out.length ? `${label} ${san}` : san);
  }
  return out.join(' ');
}

function EnginePanel({ fen, enabled, setEnabled, onPlay, onBest }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const eng = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      eng.current = new StockfishEngine(setInfo);
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
  }, [enabled]);

  useEffect(() => {
    if (enabled && eng.current) eng.current.analyse(fen);
  }, [fen, enabled]);

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
      <h3 class="flat">Stockfish 19 ${fresh && html`<span class="muted small">Tiefe ${fresh.depth}</span>`}</h3>
      <label class="check"><input type="checkbox" checked=${enabled} onChange=${e => setEnabled(e.target.checked)} /> an</label>
    </div>
    ${error && html`<div class="msg bad">${error}</div>`}
    ${enabled && !error && html`<div class="pvs">
      ${fresh
        ? fresh.lines.map(l => html`<button class="pv" onClick=${() => onPlay(l.pv[0])} title="Ersten Zug übernehmen">
            <b class=${(l.mate != null ? l.mate : l.cp) >= 0 ? 'ev w' : 'ev b'}>${formatScore(l)}</b>
            <span>${de(pvToSan(fen, l.pv))}</span>
          </button>`)
        : html`<span class="muted small">rechnet …</span>`}
    </div>`}
  </div>`;
}

function ExplorerPanel({ fen, settings, setSettings, repId, onPlay }) {
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
          setState({ data: null, error: err.auth ? '' : err instanceof TypeError ? 'Keine Verbindung zur Lichess-Datenbank.' : err.message, loading: false });
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
          <button class="btn primary" onClick=${() => startLogin({ name: 'edit', repId })}>Mit Lichess anmelden</button>`
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
    ${enabled && html`
      ${cur && cur.error && html`<div class="msg bad">${cur.error}</div>`}
      ${!cur && html`<span class="muted small">lädt …</span>`}
      ${d && d.status === 'ok' && html`<table class="table explorer cloud">
        <tbody>
          ${d.moves.slice(0, 8).map(m => html`<tr onClick=${() => onPlay(m.san)} title="Zug übernehmen">
            <td><b>${de(m.san)}</b></td>
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
      ${d && d.status === 'invalid board' && html`<div class="muted small">ChessDB kann diese Stellung nicht auswerten.</div>`}
    `}
  </div>`;
}

const pct = x => (x >= 0.1 ? Math.round(x * 100) : (x * 100).toFixed(1).replace('.', ',')) + ' %';

/** Abdeckung: häufige Gegnerzüge, die im Repertoire fehlen. */
function CoveragePanel({ rep, settings, setSettings, onJump }) {
  const [run, setRun] = useState(null); // { checked } während der Prüfung
  const [res, setRes] = useState(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current && abort.current.abort(), []);
  const token = settings.lichessToken;
  const preset = PRESETS[settings.explorer] || PRESETS.all;

  const start = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setRes(null);
    setRun({ checked: 0 });
    const r = await scanCoverage(rep, {
      preset: settings.explorer,
      token,
      min: settings.coverMin,
      signal: ctl.signal,
      onProgress: checked => setRun({ checked }),
    });
    setRes(ctl.signal.aborted && !r.gaps.length ? null : r);
    setRun(null);
  };

  const row = g => html`<button class="item" onClick=${() => onJump(g.ci, g.path)} title="Zur Stellung springen">
    <span class="count">${pct(g.inc)}</span>
    <span class="grow small">
      ${g.type === 'answer'
        ? html`Nach <b>${de(lineText(rep, g.ci, g.path)) || 'der Grundstellung'}</b> hast du keinen Zug.`
        : html`<b>${moveLabel(g.fen)} ${de(g.san)}</b> <span class="muted">nach ${de(lineText(rep, g.ci, g.path)) || 'der Grundstellung'} · spielen dort ${pct(g.share)}</span>`}
    </span>
  </button>`;

  const missing = res ? res.gaps.filter(g => g.type !== 'end') : [];
  const ends = res ? res.gaps.filter(g => g.type === 'end') : [];

  return html`<div class="card">
    <div class="row between">
      <h3 class="flat">Abdeckung</h3>
      <select class="auto" value=${settings.coverMin} onChange=${e => setSettings({ coverMin: +e.target.value })} title="Ab welchem Anteil an allen Partien ein fehlender Zug gemeldet wird">
        ${[0.05, 0.02, 0.01, 0.005].map(v => html`<option value=${v}>ab ${pct(v)} der Partien</option>`)}
      </select>
    </div>
    <p class="muted small">Prüft mit der Eröffnungsdatenbank (${preset.label}), welche häufigen Gegnerzüge im Repertoire fehlen. Die Prozentzahl sagt, in wie vielen deiner Partien der Zug aufs Brett kommt.</p>
    ${!token
      ? html`<div class="muted small">Dafür ist die Lichess-Anmeldung nötig (siehe Eröffnungsdatenbank oben).</div>`
      : run
        ? html`<div class="row"><span class="muted small">${run.checked} Stellungen geprüft …</span><button class="btn small" onClick=${() => abort.current.abort()}>Abbrechen</button></div>`
        : html`<button class="btn primary" onClick=${start}>${res ? 'Erneut prüfen' : 'Abdeckung prüfen'}</button>`}
    ${res && html`
      ${res.error && html`<div class="msg bad">${res.error}</div>`}
      ${res.truncated && html`<div class="muted small">Nach ${res.checked} Stellungen gestoppt – die wichtigsten Lücken stehen unten.</div>`}
      ${!res.gaps.length && !res.error && html`<div class="muted small">Keine Lücken über der Schwelle gefunden (${res.checked} Stellungen geprüft).</div>`}
      ${missing.length > 0 && html`<div class="eyebrow">Fehlende Gegnerzüge (${missing.length})</div><div class="list cover">${missing.map(row)}</div>`}
      ${ends.length > 0 && html`<div class="eyebrow">Linie endet, Gegner spielt weiter (${ends.length})</div><div class="list cover">${ends.map(row)}</div>`}
    `}
  </div>`;
}

const RESULT = { white: '1-0', black: '0-1' };

/** Meisterpartien mit der aktuellen Stellung, zum Durchspielen. */
function ModelGamesPanel({ fen, token, orientation }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ fen: null, games: null, error: '' });
  const [view, setView] = useState(null); // { pgn, game }
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open || !token) return;
    let live = true;
    const t = setTimeout(() => {
      masterGames(fen, token)
        .then(games => live && setState({ fen, games, error: '' }))
        .catch(err => live && setState({ fen, games: null, error: err instanceof TypeError ? 'Keine Verbindung zur Lichess-Datenbank.' : err.message }));
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
      <h3 class="flat">Musterpartien</h3>
      <button class="link small" onClick=${() => setOpen(!open)}>${open ? 'ausblenden' : 'anzeigen'}</button>
    </div>
    ${open && (!token
      ? html`<div class="muted small">Dafür ist die Lichess-Anmeldung nötig (siehe Eröffnungsdatenbank oben).</div>`
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
            ${(m.label.endsWith('.') || k === 0) && html`<span class="no">${m.label}</span>`}${de(m.san)}
          </span>`)}
        </div>
      </div>
    </div>
  </div>`;
}
