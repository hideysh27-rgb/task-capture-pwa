import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain, dummyConfig, response } from './helpers/load-app.mjs';

function setup(t, replies = [response()]) {
  const env = loadApp(t, { responses: replies });
  env.app.config = dummyConfig();
  return env;
}

test('A1 api: 設定URLへPOSTしContent-Typeを指定する', async t => {
  const { app, calls } = setup(t);
  await app.api('list_today');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, dummyConfig().url);
  assert.equal(calls[0].method, 'POST');
  assert.deepStrictEqual(calls[0].headers, { 'Content-Type': 'text/plain;charset=utf-8' });
});
test('A2 api: token・action・payloadを本文直下に含める', async t => {
  const { app, calls } = setup(t);
  const payload = { text: 'ダミータスク', due: null, area: 'ダミー領域' };
  await app.api('create', payload);
  assert.deepStrictEqual(JSON.parse(calls[0].body), { token: 'dummy-token', action: 'create', ...payload });
});
test('A3 api: 成功応答の内容をそのまま返す', async t => {
  const data = { ok: true, items: [{ id: 'dummy-id', title: 'ダミー' }], count: 1 };
  const { app } = setup(t, [response(data)]);
  assert.deepStrictEqual(plain(await app.api('list_today')), data);
});
test('A4 api: 第3引数の設定をグローバル設定より優先する', async t => {
  const { app, calls } = setup(t);
  const override = { url: 'https://example.invalid/override', token: 'dummy-override' };
  await app.api('list_today', null, override);
  assert.equal(calls[0].url, override.url);
  assert.deepStrictEqual(JSON.parse(calls[0].body), { token: override.token, action: 'list_today' });
  assert.deepStrictEqual(plain(app.config), dummyConfig());
});

for (const [name, reply, message, kind] of [
  ['A5 fetch自体の失敗', { reject: new Error('dummy offline') }, '通信できませんでした', 'network'],
  ['A6 非JSON・status 200', { text: '<html>dummy</html>', status: 200 }, 'サーバーの応答が不正です。URLを確認してください', 'server'],
  ['A7 非JSON・status 500', { text: '<html>dummy</html>', status: 500 }, 'サーバーが 500 を返しました', 'server'],
  ['A8 forbidden', response({ ok: false, error: 'forbidden' }), '合言葉(APP_TOKEN)が違います', 'server'],
  ['A9 任意のエラー', response({ ok: false, error: '何か' }), '何か', 'server'],
  ['A10 エラー内容なし', response({ ok: false }), '不明なエラー', 'server']
]) {
  test(`${name}: エラー種別と文言が一致する`, async t => {
    const { app } = setup(t, [reply]);
    await assert.rejects(app.api('create', { text: 'ダミー' }), error => {
      assert.equal(error.message, message);
      assert.equal(error[kind], true);
      assert.equal(error[kind === 'network' ? 'server' : 'network'], undefined);
      return true;
    });
  });
}
