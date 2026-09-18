/* タスク捕獲PWA — フロント
 *
 * 方針:
 *  - 接続先（GASのURL）と合言葉はソースに書かず、初回起動時に入力して localStorage に置く。
 *    → 公開リポジトリに置いてもシークレットが1つも入らない。
 *  - 捕獲はテキスト1つで完結させる。期限も領域も任意。入力に条件を増やすと結局書かなくなる。
 *  - 圏外でも送信できたことにする（localStorage に積み、オンライン復帰時に自動で流す）。
 */

'use strict';

var CFG_KEY = 'capture.config';
var QUEUE_KEY = 'capture.queue';

var config = null;
var selected = { due: null, area: null };
var editingId = null;

// ── 起動 ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  config = loadConfig();
  if (config) { startApp(); } else { showSetup(); }
});

function loadConfig() {
  try {
    var raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    var c = JSON.parse(raw);
    return (c && c.url && c.token) ? c : null;
  } catch (e) { return null; }
}

function showSetup() {
  show('setup');
  document.getElementById('setup-save').addEventListener('click', function () {
    var url = document.getElementById('setup-url').value.trim();
    var token = document.getElementById('setup-token').value.trim();
    if (!url || !token) { toast('URLと合言葉の両方が必要です'); return; }
    config = { url: url, token: token };
    localStorage.setItem(CFG_KEY, JSON.stringify(config));
    hide('setup');
    startApp();
  });
}

function startApp() {
  hide('setup');
  show('app');
  bindTabs();
  bindChips();
  bindCapture();

  flushQueue();                                  // 前回オフラインで積んだ分を先に流す
  window.addEventListener('online', flushQueue);

  refreshInboxBadge();
  focusCapture();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても本体は動く */ });
  }
}

// ── 通信 ────────────────────────────────────────────────

/**
 * GAS へは text/plain で送る。application/json にするとプリフライト（OPTIONS）が飛び、
 * GAS がそれに応えられないので CORS で落ちる。ここは変えないこと。
 */
function api(action, payload) {
  var body = Object.assign({ token: config.token, action: action }, payload || {});
  return fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.json();
  }).then(function (data) {
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    return data;
  });
}

// ── 捕獲 ────────────────────────────────────────────────

function bindCapture() {
  document.getElementById('capture-send').addEventListener('click', send);

  // 物理キーボード等での Ctrl/Cmd + Enter 送信
  document.getElementById('capture-text').addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
  });
}

function send() {
  var el = document.getElementById('capture-text');
  var text = el.value.trim();
  if (!text) { el.focus(); return; }

  var item = { text: text, due: selected.due, area: selected.area };

  // 先に画面を空にする。送信結果を待たせると「連続で打ち込む」ができなくなるため。
  el.value = '';
  clearChips();
  el.focus();

  api('create', item).then(function () {
    toast('登録しました');
    refreshInboxBadge();
  }).catch(function () {
    enqueue(item);
    toast('圏外のため保存しました（後で自動送信）');
  });
}

function bindChips() {
  document.querySelectorAll('.chips').forEach(function (group) {
    var key = group.dataset.group;
    group.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var on = chip.classList.contains('on');
        // 同じ列は1つだけ選べる。もう一度押すと解除
        group.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
        if (!on) { chip.classList.add('on'); selected[key] = chip.dataset.value; }
        else { selected[key] = null; }
      });
    });
  });
}

function clearChips() {
  document.querySelectorAll('.chip.on').forEach(function (c) { c.classList.remove('on'); });
  selected = { due: null, area: null };
}

function focusCapture() {
  var el = document.getElementById('capture-text');
  if (el) el.focus();
}

// ── オフラインの積み置き ────────────────────────────────

function enqueue(item) {
  var q = readQueue();
  q.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  renderQueueNote();
}

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
}

/** 1件ずつ順に送り、失敗した時点で残りを積み直す（順番と件数を壊さないため）。 */
function flushQueue() {
  var q = readQueue();
  if (!q.length) { renderQueueNote(); return; }

  var rest = q.slice();
  function step() {
    if (!rest.length) {
      localStorage.removeItem(QUEUE_KEY);
      renderQueueNote();
      toast(q.length + '件を送信しました');
      return;
    }
    var item = rest[0];
    api('create', item).then(function () {
      rest.shift();
      localStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
      step();
    }).catch(function () {
      renderQueueNote();  // まだ繋がらない。次の online イベントで再挑戦する
    });
  }
  step();
}

function renderQueueNote() {
  var n = readQueue().length;
  var el = document.getElementById('queue-note');
  el.textContent = n ? '未送信 ' + n + '件（オンラインになったら自動送信）' : '';
}

// ── タブ ────────────────────────────────────────────────

function bindTabs() {
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      ['capture', 'today', 'inbox'].forEach(function (t) {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== name);
      });
      if (name === 'today') loadToday();
      if (name === 'inbox') loadInbox();
      if (name === 'capture') focusCapture();
    });
  });
}

// ── 今日 ────────────────────────────────────────────────

/* 並べ替えができるよう、取得した一覧をここに持っておく。
   画面はこの配列から描き直す（サーバーの返事を待たずに動かしたいため）。 */
var todayItems = [];

function loadToday() {
  var list = document.getElementById('today-list');
  list.innerHTML = '<p class="note">読み込み中...</p>';

  api('list_today').then(function (data) {
    todayItems = data.items;
    renderToday();
  }).catch(function (e) {
    list.innerHTML = '<p class="note">読み込めませんでした: ' + escapeHtml(e.message) + '</p>';
  });
}

function renderToday() {
  var list = document.getElementById('today-list');
  list.innerHTML = '';
  document.getElementById('today-empty').classList.toggle('hidden', todayItems.length > 0);
  todayItems.forEach(function (item, i) { list.appendChild(todayCard(item, i)); });
}

function todayCard(item, index) {
  var card = el('div', 'card');

  var head = el('div', 'card-head');
  var body = el('div', 'card-body');
  body.appendChild(el('div', 'title', item.title));
  body.appendChild(metaRow(item));
  head.appendChild(body);

  // 「…」だけを常時出しておく。ボタンを並べると本文タップ（＝完了）を押し間違えるため
  var more = el('button', 'more', '⋯');
  more.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = card.querySelector('.actions');
    if (open) { open.remove(); } else { card.appendChild(actionsRow(item, index, card)); }
  });
  head.appendChild(more);
  card.appendChild(head);

  // AIが集めてきた補足。出典が無いものは書かせていないので、あれば必ずリンクが付く
  if (item.note) {
    var note = el('div', 'enrich');
    note.appendChild(el('span', 'enrich-mark', '補足'));
    note.appendChild(el('span', '', item.note));
    card.appendChild(note);
  } else if (item.noteState === '要確認') {
    card.appendChild(el('div', 'enrich warn', '補足できませんでした（情報が特定できず）'));
  }

  // 本文のどこを押しても完了。一番よく使う操作なので狙いを定めなくていいようにする
  body.addEventListener('click', function () { completeItem(item, card); });

  return card;
}

function actionsRow(item, index, card) {
  var row = el('div', 'actions');

  var up = el('button', '', '↑');
  up.disabled = index === 0;
  up.addEventListener('click', function (e) { e.stopPropagation(); moveItem(index, -1); });

  var down = el('button', '', '↓');
  down.disabled = index === todayItems.length - 1;
  down.addEventListener('click', function (e) { e.stopPropagation(); moveItem(index, 1); });

  var pri = el('button', 'pri pri-' + (item.priority || '中'), '優先度 ' + (item.priority || '中'));
  pri.addEventListener('click', function (e) { e.stopPropagation(); cyclePriority(item); });

  var del = el('button', 'danger', '削除');
  del.addEventListener('click', function (e) { e.stopPropagation(); archiveItem(item, card); });

  [up, down, pri, del].forEach(function (b) { row.appendChild(b); });
  return row;
}

function completeItem(item, card) {
  card.style.opacity = '0.4';
  api('complete', { id: item.id }).then(function () {
    dropItem(item.id);
    toastWithUndo('完了にしました', function () {
      api('complete', { id: item.id, undo: true }).then(loadToday);
    });
  }).catch(function (e) {
    card.style.opacity = '1';
    toast('失敗: ' + e.message);
  });
}

/** 高 → 中 → 低 → 高 と回すだけ。選ばせる画面は出さない（タップ数を増やさない）。 */
function cyclePriority(item) {
  var order = ['高', '中', '低'];
  var next = order[(order.indexOf(item.priority || '中') + 1) % 3];
  item.priority = next;
  renderToday();
  api('set_priority', { id: item.id, priority: next })
    .catch(function (e) { toast('優先度を変えられませんでした: ' + e.message); loadToday(); });
}

/**
 * 並べ替え。先に画面を動かしてから保存する。
 * 通信を待つと連続で入れ替えられず、操作感が落ちるため。
 */
function moveItem(index, dir) {
  var to = index + dir;
  if (to < 0 || to >= todayItems.length) return;
  var tmp = todayItems[index];
  todayItems[index] = todayItems[to];
  todayItems[to] = tmp;
  renderToday();
  saveOrder();
}

var orderTimer = null;

/** 連続で↑↓を押したときに毎回送らないよう、最後の操作から少し待ってまとめて送る。 */
function saveOrder() {
  clearTimeout(orderTimer);
  orderTimer = setTimeout(function () {
    api('reorder', {
      ids: todayItems.map(function (i) { return i.id; }),
      currentOrders: todayItems.map(function (i) { return i.order; })
    }).then(function () {
      todayItems.forEach(function (it, i) { it.order = (i + 1) * 10; });
    }).catch(function (e) {
      toast('並び順を保存できませんでした: ' + e.message);
      loadToday();
    });
  }, 600);
}

/** 削除。Notionのゴミ箱に入るだけなので元に戻せる。 */
function archiveItem(item, card) {
  card.style.opacity = '0.4';
  api('archive', { id: item.id }).then(function () {
    dropItem(item.id);
    toastWithUndo('削除しました', function () {
      api('archive', { id: item.id, undo: true }).then(loadToday);
    });
  }).catch(function (e) {
    card.style.opacity = '1';
    toast('失敗: ' + e.message);
  });
}

function dropItem(id) {
  todayItems = todayItems.filter(function (i) { return i.id !== id; });
  renderToday();
}

// ── 受信箱 ──────────────────────────────────────────────

function loadInbox() {
  var list = document.getElementById('inbox-list');
  list.innerHTML = '<p class="note">読み込み中...</p>';

  api('list_inbox').then(function (data) {
    list.innerHTML = '';
    document.getElementById('inbox-empty').classList.toggle('hidden', data.items.length > 0);
    data.items.forEach(function (item) { list.appendChild(inboxCard(item)); });
    setBadge(data.items.length);
  }).catch(function (e) {
    list.innerHTML = '<p class="note">読み込めませんでした: ' + escapeHtml(e.message) + '</p>';
  });
}

function inboxCard(item) {
  var card = el('div', 'card');
  card.appendChild(el('div', 'title', item.title));
  card.appendChild(metaRow(item));

  if (item.excerpt) card.appendChild(el('div', 'excerpt', item.excerpt));

  // 元の発言・予定へ戻れるようにする。本文を持ち込まない代わりの導線
  if (item.sourceUrl) {
    var a = document.createElement('a');
    a.href = item.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '元のメッセージを見る';
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    card.appendChild(a);
  }

  var row = el('div', 'verdicts');
  row.appendChild(verdictBtn('v-ok', 'そのまま', function () { judge(card, item, 'ok'); }));
  row.appendChild(verdictBtn('v-ng', '不要', function () { judge(card, item, 'ng'); }));
  row.appendChild(verdictBtn('v-fix', '直す', function () { toggleEditor(card, item); }));
  card.appendChild(row);

  return card;
}

function verdictBtn(cls, label, fn) {
  var b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function judge(card, item, verdict, extra) {
  card.style.opacity = '0.4';
  api('feedback', Object.assign({ id: item.id, verdict: verdict }, extra || {}))
    .then(function () {
      card.remove();
      setBadge(document.querySelectorAll('#inbox-list .card').length);
      toast(verdict === 'ng' ? '不要として記録しました' : '記録しました');
    })
    .catch(function (e) {
      card.style.opacity = '1';
      toast('失敗: ' + e.message);
    });
}

/** 直すのはタイトル・期限・領域の3つだけ。それ以上は Notion 側で開いてやる。 */
function toggleEditor(card, item) {
  var exist = card.querySelector('.editor');
  if (exist) { exist.remove(); return; }

  var box = el('div', 'editor');

  var title = document.createElement('input');
  title.type = 'text';
  title.value = item.title;
  box.appendChild(title);

  var row = el('div', 'row');
  var due = document.createElement('input');
  due.type = 'date';
  due.value = item.due || '';
  row.appendChild(due);

  var area = document.createElement('select');
  ['', '就活', 'VEXUM', 'Creare', '教職', '大学', '自分'].forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v || '(領域なし)';
    if (v === (item.area || '')) o.selected = true;
    area.appendChild(o);
  });
  row.appendChild(area);
  box.appendChild(row);

  var save = document.createElement('button');
  save.className = 'primary';
  save.textContent = 'この内容で記録';
  save.addEventListener('click', function () {
    judge(card, item, 'fix', {
      title: title.value.trim(),
      due: due.value || null,
      area: area.value || null
    });
  });
  box.appendChild(save);

  card.appendChild(box);
  title.focus();
}

function refreshInboxBadge() {
  api('list_inbox').then(function (data) { setBadge(data.items.length); }).catch(function () {});
}

function setBadge(n) {
  var b = document.getElementById('inbox-badge');
  b.textContent = n;
  b.classList.toggle('hidden', !n);
}

// ── 表示の小道具 ────────────────────────────────────────

function metaRow(item) {
  var meta = el('div', 'meta');
  if (item.due) meta.appendChild(el('span', dueClass(item.due), formatDue(item.due)));
  if (item.area) meta.appendChild(el('span', '', item.area));
  if (item.priority) meta.appendChild(el('span', '', '優先度' + item.priority));
  if (item.source) meta.appendChild(el('span', '', item.source));
  return meta;
}

function dueClass(due) {
  var d = daysUntil(due);
  if (d < 0) return 'due-over';
  if (d <= 1) return 'due-soon';
  return '';
}

function formatDue(due) {
  var d = daysUntil(due);
  var md = due.slice(5).replace('-', '/');
  if (d < 0) return md + '（' + (-d) + '日超過）';
  if (d === 0) return md + '（今日）';
  if (d === 1) return md + '（明日）';
  return md + '（あと' + d + '日）';
}

/** 端末のタイムゾーンに引きずられないよう、日付だけを見て引き算する。 */
function daysUntil(due) {
  var today = new Date();
  var t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  var p = due.split('-');
  var u = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Math.round((u - t) / 86400000);
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

var toastTimer = null;

function toast(msg) { showToast(msg, null, 2500); }

function toastWithUndo(msg, undo) { showToast(msg, undo, 5000); }

function showToast(msg, undo, ms) {
  var box = document.getElementById('toast');
  var action = document.getElementById('toast-action');
  document.getElementById('toast-text').textContent = msg;

  if (undo) {
    action.textContent = '取り消す';
    action.classList.remove('hidden');
    action.onclick = function () { box.classList.add('hidden'); undo(); };
  } else {
    action.classList.add('hidden');
    action.onclick = null;
  }

  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.classList.add('hidden'); }, ms);
}
