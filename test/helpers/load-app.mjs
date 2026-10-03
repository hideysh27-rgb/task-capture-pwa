import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
export const plain = value => JSON.parse(JSON.stringify(value));
export const dummyConfig = () => ({ url: 'https://example.invalid/exec', token: 'dummy-token' });
export const response = (data = { ok: true }, status = 200) => ({ text: JSON.stringify(data), status });

function element() {
  const listeners = [];
  const result = {
    textContent: '', className: '', onclick: null, children: [], listeners,
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(...args) { listeners.push(args); }
  };
  const classes = () => new Set(result.className.split(/\s+/).filter(Boolean));
  result.classList = {
    add(...names) { result.className = [...new Set([...classes(), ...names])].join(' '); },
    remove(...names) { result.className = [...classes()].filter(name => !names.includes(name)).join(' '); },
    contains(name) { return classes().has(name); }
  };
  return result;
}

export function loadApp(t, { storage = {}, responses = [], today = '2026-06-15T12:00:00' } = {}) {
  const values = new Map(Object.entries(storage));
  const elements = new Map();
  const documentListeners = [];
  const windowListeners = [];
  const timers = [];
  const clearedTimers = [];
  const calls = [];
  const unexpectedCalls = [];
  let consumed = 0;
  const fixedTime = new Date(today).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  }
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  getElement('toast').className = 'hidden';
  const context = vm.createContext({
    localStorage: {
      getItem(key) { return values.get(String(key)) ?? null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); }
    },
    document: {
      addEventListener(...args) { documentListeners.push(args); },
      getElementById: getElement,
      createElement: element
    },
    window: { addEventListener(...args) { windowListeners.push(args); } },
    navigator: { onLine: true },
    Date: FixedDate,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout(id) { clearedTimers.push(id); },
    async fetch(url, options) {
      const call = plain({ url, ...options });
      calls.push(call);
      if (consumed >= responses.length) {
        unexpectedCalls.push(call);
        throw new Error('未設定の fetch 呼び出し');
      }
      const next = responses[consumed++];
      if (next.reject) throw next.reject;
      return { status: next.status, async text() { return next.text; } };
    }
  });
  // アプリの catch に吸収されても、各テスト終了時の検査で必ず失敗させる。
  t.after(() => {
    assert.equal(unexpectedCalls.length, 0, `想定外の fetch: ${JSON.stringify(unexpectedCalls)}`);
    assert.equal(consumed, responses.length, '設定した応答がすべて消費される');
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  return {
    app: context, values, getElement, calls, timers, clearedTimers,
    documentListeners, windowListeners,
    async waitFor(done) {
      const deadline = Date.now() + 2000;
      do {
        // ホスト側だけでイベントループを進め、Promise の連鎖を完了させる。
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unexpectedCalls.length, 0, '待機中に想定外の fetch が発生');
        if (consumed === responses.length && done()) return;
      } while (Date.now() < deadline);
      assert.fail('2秒以内にキュー処理の完了を確認できませんでした');
    }
  };
}
