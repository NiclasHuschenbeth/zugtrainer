// Service Worker: macht den Zugtrainer offline nutzbar.
// VERSION und FILES werden vor dem Hochladen automatisch gesetzt (siehe README, "Vor dem Hochladen").
const VERSION = 'c2c857467a';
const FILES = [
  "./",
  "css/style.css",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/logo-icon.png",
  "icons/logo-wordmark-trainer.png",
  "icons/logo-wordmark.png",
  "index.html",
  "js/app.js",
  "js/config.js",
  "js/lib/analysis.js",
  "js/lib/chessdb.js",
  "js/lib/cloud.js",
  "js/lib/coverage.js",
  "js/lib/engine.js",
  "js/lib/games.js",
  "js/lib/lichess.js",
  "js/lib/openings-data.js",
  "js/lib/openings.js",
  "js/lib/pgnexport.js",
  "js/lib/repertoire.js",
  "js/lib/sample.js",
  "js/lib/sound.js",
  "js/lib/srs.js",
  "js/lib/storage.js",
  "js/lib/sync.js",
  "js/ui/account.js",
  "js/ui/board.js",
  "js/ui/compare.js",
  "js/ui/editor.js",
  "js/ui/games.js",
  "js/ui/menu.js",
  "js/ui/onboarding.js",
  "js/ui/repertoires.js",
  "js/ui/scrim.js",
  "js/ui/stats.js",
  "js/ui/trainer.js",
  "manifest.webmanifest",
  "vendor/badrap/result.mjs",
  "vendor/chessground/chessground.base.css",
  "vendor/chessground/chessground.brown.css",
  "vendor/chessground/chessground.cburnett.css",
  "vendor/chessground/chessground.min.js",
  "vendor/chessops/attacks.js",
  "vendor/chessops/board.js",
  "vendor/chessops/chess.js",
  "vendor/chessops/compat.js",
  "vendor/chessops/fen.js",
  "vendor/chessops/pgn.js",
  "vendor/chessops/san.js",
  "vendor/chessops/setup.js",
  "vendor/chessops/squareSet.js",
  "vendor/chessops/transform.js",
  "vendor/chessops/types.js",
  "vendor/chessops/util.js",
  "vendor/chessops/variant.js",
  "vendor/fonts/raleway/raleway-latin-ext.woff2",
  "vendor/fonts/raleway/raleway-latin.woff2",
  "vendor/preact/standalone.module.js",
  "vendor/stockfish/stockfish-19-lite-single.js",
  "vendor/stockfish/stockfish-19-lite-single.wasm",
  "vendor/supabase/supabase.js"
];
const CACHE = `zugtrainer-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('zugtrainer-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Fremde Dienste (Lichess, Chess.com, ChessDB) laufen immer direkt übers Netz.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Bibliotheken und Stockfish ändern sich nur mit neuer Version: zuerst aus dem Speicher.
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')) {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetchAndStore(req)));
    return;
  }

  // Alles andere: frisch aus dem Netz, ohne Verbindung aus dem Speicher.
  event.respondWith(
    fetchAndStore(req).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())),
    ),
  );
});

async function fetchAndStore(req) {
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}
