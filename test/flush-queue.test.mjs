import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, dummyConfig, response } from './helpers/load-app.mjs';

const items = () => [1, 2, 3].map(n => ({ text: `ダミー${n}`, due: null, area: null }));
const note = '未送信 2件（オンラインになったら自動送信）';

function setup(t, queue, responses) {
  const env = loadApp(t, { storage: { 'capture.queue': JSON.stringify(queue) }, responses });
  env.app.config = dummyConfig();
  return env;
}
function assertSent(env, expected) {
  assert.equal(env.calls.length, expected.length);
  assert.deepStrictEqual(env.calls.map(call => JSON.parse(call.body)),
    expected.map(item => ({ token: 'dummy-token', action: 'create', ...item })));
}

test('F1 flushQueue: 空ならfetchを呼ばない', async t => {
  const env = setup(t, [], []);
  env.app.flushQueue();
  await env.waitFor(() => env.getElement('queue-note').textContent === '');
  assertSent(env, []);
  assert.equal(env.getElement('toast-text').textContent, '');
  assert.equal(env.getElement('toast').classList.contains('hidden'), true);
});
test('F2 flushQueue: 3件を順番に送信しキーを削除して成功を表示する', async t => {
  const queue = items();
  const env = setup(t, queue, [response(), response(), response()]);
  env.app.flushQueue();
  await env.waitFor(() => !env.values.has('capture.queue') &&
    env.getElement('toast-text').textContent === '3件を送信しました');
  assertSent(env, queue);
  assert.equal(env.values.has('capture.queue'), false);
  assert.equal(env.getElement('queue-note').textContent, '');
  assert.equal(env.getElement('toast-text').textContent, '3件を送信しました');
  assert.equal(env.getElement('toast').classList.contains('hidden'), false);
});
test('F3 flushQueue: 2件目の通信失敗で止まり残り2件を保持しtoastを出さない', async t => {
  const queue = items();
  const env = setup(t, queue, [response(), { reject: new Error('dummy offline') }]);
  env.app.flushQueue();
  await env.waitFor(() => env.getElement('queue-note').textContent === note);
  assertSent(env, queue.slice(0, 2));
  assert.deepStrictEqual(JSON.parse(env.values.get('capture.queue')), queue.slice(1));
  assert.equal(env.getElement('toast-text').textContent, '');
  assert.equal(env.getElement('toast').classList.contains('hidden'), true);
  assert.equal(env.timers.length, 0);
});
test('F4 flushQueue: 2件目のサーバーエラーで止まり残り2件と原因を表示する', async t => {
  const queue = items();
  const env = setup(t, queue, [response(), response({ ok: false, error: 'ダミーの拒否理由' })]);
  const message = '未送信を送れません: ダミーの拒否理由';
  env.app.flushQueue();
  await env.waitFor(() => env.getElement('toast-text').textContent === message);
  assertSent(env, queue.slice(0, 2));
  assert.deepStrictEqual(JSON.parse(env.values.get('capture.queue')), queue.slice(1));
  assert.equal(env.getElement('queue-note').textContent, note);
  assert.equal(env.getElement('toast-text').textContent, message);
  assert.equal(env.getElement('toast').classList.contains('hidden'), false);
});
