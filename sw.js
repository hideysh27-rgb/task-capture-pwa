/* Service Worker — ホーム画面から即座に開くための最小構成。
 *
 * 方針:
 *  - 画面の素材（HTML/CSS/JS/アイコン）だけをキャッシュする。起動の速さがこのアプリの価値なので。
 *  - GAS への通信（POST）は絶対にキャッシュしない。古いタスク一覧を掴むと混乱するため。
 *  - 中身を書き換えたら CACHE_NAME の番号を上げる。上げ忘れると端末が古いまま止まる。
 */

var CACHE_NAME = 'task-capture-v1';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
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

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // 表示はキャッシュで即返しつつ、裏で新しいものを取っておく
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE_NAME).then(function (c) { c.put(req, res.clone()); });
        }).catch(function () {});
        return hit;
      }
      return fetch(req);
    })
  );
});
