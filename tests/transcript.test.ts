import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transcript } from '../src/transcript.js';
import type { Conversation } from '../src/model.js';

function transcript(): Transcript {
  const record: Conversation = { version: 1, id: 'task', parentSessionId: 'parent', provider: 'claude-code', backend: 'claude-code', title: '任务', cwd: '.', permissionMode: 'dontAsk', status: 'idle', createdAt: 1, updatedAt: 1, revision: 0, items: [], turns: [] };
  const result = new Transcript(record, () => { record.revision++; });
  result.begin('turn');
  return result;
}

test('Claude 同名并行工具按原生 ID 合并快照与结果', () => {
  const t = transcript();
  const event = (event: unknown) => t.claude({ type: 'stream_event', event });
  event({ type: 'message_start', message: { id: 'm1' } });
  for (const [index, id] of ['a', 'b'].entries()) {
    event({ type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'Read', input: {} } });
    event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: `{"file_path":"${id}.txt"}` } });
    t.claude({ type: 'assistant', uuid: `snapshot-${id}`, message: { id: 'm1', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `${id}.txt` } }] } });
  }
  for (const id of ['a', 'b']) {
    t.claude({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `${id} 的输出` }] } });
  }
  assert.equal(t.conversation.items.length, 2);
  for (const [index, id] of ['a', 'b'].entries()) {
    assert.match(t.conversation.items[index].input!, new RegExp(`${id}\\.txt`));
    assert.equal(t.conversation.items[index].text, `${id} 的输出`);
    assert.equal(t.conversation.items[index].status, 'completed');
  }
  assert.equal(new Set(t.conversation.items.map(item => item.id)).size, 2);
});

test('Claude 流式文本、单块最终快照及重复快照只保留一个节点', () => {
  const t = transcript();
  t.claude({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
  for (let index = 0; index < 2; index++) {
    t.claude({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
    t.claude({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: `回答${index}` } } });
    const message = { type: 'assistant', uuid: `s${index}`, message: { id: 'm1', content: [{ type: 'text', text: `回答${index}` }] } };
    t.claude(message);
    t.claude(message);
  }
  assert.deepEqual(t.conversation.items.map(item => item.text), ['回答0', '回答1']);
});

test('Codex 最终快照覆盖增量且首轮结果只返回最终回答', () => {
  const t = transcript();
  t.codex('item/completed', { item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: '正在检查' } });
  t.codex('item/agentMessage/delta', { itemId: 'final', delta: '完成' });
  t.codex('item/completed', { item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '完成检查' } });
  assert.equal(t.answer(), '完成检查');
  assert.equal(t.conversation.items.length, 2);
});

test('结束轮次保留已收到的 token 用量', () => {
  const t = transcript();
  t.conversation.turns[0].inputTokens = 123;
  t.finish('completed');
  assert.equal(t.conversation.turns[0].inputTokens, 123);
});
