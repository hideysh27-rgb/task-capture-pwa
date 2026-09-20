/* Service Worker — ホーム画面から即座に開くための最小構成。
 *
 * 方針:
 *  - 画面の素材（HTML/CSS/JS/アイコン）だけをキャッシュする。起動の速さがこのアプリの価値なので。
 *  - GAS への通信（POST）は絶対にキャッシュしない。古いタスク一覧を掴むと混乱するため。
 *
 * ⚠ 更新するときは **2か所**を必ず一緒に直す（片方だけだと端末が古いまま止まる）:
 *   1. index.html の `?v=N`（style.css / app.js / manifest.json の3行）
 *   2. このファイルの VERSION
 *
 * なぜ `?v=N` が要るか（2026-09-20 に実際にハマった）:
 *   GitHub Pages は Cache-Control: max-age=600 を返すため、ファイル名が同じままだと
 *   **ブラウザが最大10分間ふるい app.js を使い続ける**。HTMLだけ新しくてJSが古い、という
 *   ちぐはぐな状態になり、原因の特定に時間を取られた。URLを変えれば確実に取り直される。
 */

var VERSION = 4;
var CACHE_NAME = 'task-capture-v' + VERSION;

var SHELL = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './manifest.json?v=' + VERSION,
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })  // 新版を待たせずに適用する
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_NAME ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // GET 以外（＝GASへの POST）は素通し。キャッシュに触れさせない。
  if (req.method !== 'GET') return;

  // 別ドメイン（script.google.com 等）も素通し。
  if (new URL(req.url).origin !== self.location.origin) return;

  // ページ本体（index.html）だけは**ネットワーク優先**。
  // ここはURLにバージョンを付けられないので、キャッシュ優先にすると更新が1回遅れる。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        // 圏外。前回のページを出して、捕獲だけでもできるようにする
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  // それ以外（CSS/JS/アイコン）は URL にバージョンが入っているので、
  // キャッシュ優先で安全。中身が変わればURLも変わる。
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
