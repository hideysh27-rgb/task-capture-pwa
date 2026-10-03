import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain, dummyConfig } from './helpers/load-app.mjs';

for (const [name, raw, expected] of [
  ['C1 loadConfig: 保存なしなら null', undefined, null],
  ['C2 loadConfig: 壊れたJSONなら null', '{broken', null],
  ['C3 loadConfig: url がなければ null', JSON.stringify({ token: 'dummy-token' }), null],
  ['C4 loadConfig: token がなければ null', JSON.stringify({ url: 'https://example.invalid/exec' }), null],
  ['C5 loadConfig: 保存した設定を返す', JSON.stringify(dummyConfig()), dummyConfig()]
]) {
  test(name, t => {
    const { app } = loadApp(t, { storage: raw === undefined ? {} : { 'capture.config': raw } });
    assert.deepStrictEqual(plain(app.loadConfig()), expected);
  });
}

test('Q1 readQueue: 保存なしなら空配列', t => {
  assert.deepStrictEqual(plain(loadApp(t).app.readQueue()), []);
});
test('Q2 readQueue: 壊れたJSONなら空配列', t => {
  const { app } = loadApp(t, { storage: { 'capture.queue': '{broken' } });
  assert.deepStrictEqual(plain(app.readQueue()), []);
});
test('Q3 enqueue: 末尾に追加して保存し未送信件数を表示する', t => {
  const existing = [{ text: 'ダミー1' }, { text: 'ダミー2' }];
  const item = { text: 'ダミー3', due: null, area: null };
  const { app, values, getElement } = loadApp(t, { storage: { 'capture.queue': JSON.stringify(existing) } });
  app.enqueue(item);
  assert.deepStrictEqual(JSON.parse(values.get('capture.queue')), [...existing, item]);
  assert.deepStrictEqual(plain(app.readQueue()), [...existing, item]);
  assert.equal(getElement('queue-note').textContent, '未送信 3件（オンラインになったら自動送信）');
});

for (const [name, today, cases] of [
  ['D1 昨日', '2026-06-15', [['2026-06-14', -1, 'due-over', '06/14（1日超過）']]],
  ['D2 今日', '2026-06-15', [['2026-06-15', 0, 'due-soon', '06/15（今日）']]],
  ['D3 明日', '2026-06-15', [['2026-06-16', 1, 'due-soon', '06/16（明日）']]],
  ['D4 2日後', '2026-06-15', [['2026-06-17', 2, '', '06/17（あと2日）']]],
  ['D5 月末をまたぐ', '2026-01-31', [['2026-02-01', 1, 'due-soon', '02/01（明日）']]],
  ['D6 年末をまたぐ', '2026-12-31', [
    ['2027-01-01', 1, 'due-soon', '01/01（明日）'],
    ['2026-12-30', -1, 'due-over', '12/30（1日超過）']
  ]]
]) {
  test(`${name}: 日数・クラス・表示全文が一致する`, t => {
    const { app } = loadApp(t, { today: `${today}T12:00:00` });
    for (const [due, days, cls, label] of cases) {
      assert.equal(app.daysUntil(due), days);
      assert.equal(app.dueClass(due), cls);
      assert.equal(app.formatDue(due), label);
    }
  });
}

test('E1 escapeHtml: & < > " をそれぞれ変換する', t => {
  const { app } = loadApp(t);
  for (const [input, expected] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;']]) {
    assert.equal(app.escapeHtml(input), expected);
  }
  assert.equal(app.escapeHtml('&<>"'), '&amp;&lt;&gt;&quot;');
});
test('E2 escapeHtml: 日本語・単引用符・数字を保ち数値を文字列にする', t => {
  const { app } = loadApp(t);
  assert.equal(app.escapeHtml("日本語'123"), "日本語'123");
  assert.equal(app.escapeHtml(123), '123');
});
