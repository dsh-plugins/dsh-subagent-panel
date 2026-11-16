import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { JsonLines, RpcChannel } from '../src/line-channel.js';

test('JSON 行协议支持 UTF-8 任意分片、CRLF 和无结尾换行', () => {
  const messages: unknown[] = [];
  const lines = new JsonLines(value => messages.push(value));
  const bytes = Buffer.from('{"text":"你好🌟"}\r\n\n{"id":2}');
  for (const byte of bytes) {
    lines.write(Buffer.from([byte]));
  }
  lines.end();
  assert.deepEqual(messages, [{ text: '你好🌟' }, { id: 2 }]);
});

test('JSON 行协议拒绝无效根结构', () => {
  const lines = new JsonLines(() => { assert.fail('无效消息不得进入消费者'); });
  assert.throws(() => lines.write('[]\n'), /无效/);
});

test('RPC 响应可乱序返回，关闭时清理待决请求', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const channel = new RpcChannel(input, output, () => { assert.fail('响应不应被当作通知'); }, assert.fail);
  const first = channel.request('first', {});
  const second = channel.request('second', {});
  input.write('{"id":"panel-2","result":{"order":2}}\n');
  input.write('{"id":"panel-1","result":{"order":1}}\n');
  assert.deepEqual(await second, { order: 2 });
  assert.deepEqual(await first, { order: 1 });
  const pending = channel.request('third', {});
  channel.close();
  await assert.rejects(pending, /关闭/);
  input.destroy();
  output.destroy();
});

test('RPC 写入断管只失败一次且接住稍后的 stream error', async () => {
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('模拟 EPIPE')); } });
  let failures = 0;
  const channel = new RpcChannel(input, output, () => { assert.fail('不能收到通知'); }, () => { failures++; });
  await assert.rejects(channel.request('initialize', {}), /EPIPE/);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(failures, 1);
  input.destroy();
});
