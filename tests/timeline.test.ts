import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeline } from '../src/client/timeline.js';
import type { TranscriptItem, Turn } from '../src/model.js';

function item(id: string, turn: string, kind: TranscriptItem['kind'], time: number): TranscriptItem {
  return { id, turn, kind, time, text: id };
}

test('同毫秒的任务输入、轮次标题、过程、结果与用量按会话顺序排列', () => {
  const turns: Turn[] = [{ id: 'a', startedAt: 10, endedAt: 10, status: 'completed' }];
  const items = [item('input', 'a', 'user', 10), item('tool', 'a', 'tool', 10), item('answer', 'a', 'assistant', 10)];
  assert.deepEqual(timeline({ items, turns }).map(entry => entry.key), ['input', 'turn:a', 'tool', 'answer', 'tail:a']);
});

test('相邻轮次同毫秒交接时上一轮用量位于下一轮输入之前', () => {
  const turns: Turn[] = [{ id: 'a', startedAt: 1, endedAt: 10, status: 'completed' }, { id: 'b', startedAt: 10, status: 'running' }];
  const items = [item('answer-a', 'a', 'assistant', 10), item('input-b', 'b', 'user', 10), item('answer-b', 'b', 'assistant', 10)];
  assert.deepEqual(timeline({ items, turns }).map(entry => entry.key), ['turn:a', 'answer-a', 'tail:a', 'input-b', 'turn:b', 'answer-b']);
});

test('运行中追加与尚未启动的输入保留事件顺序且不产生完成用量行', () => {
  const turns: Turn[] = [{ id: 'a', startedAt: 10, status: 'running' }];
  const items = [item('input', 'a', 'user', 9), item('tool', 'a', 'tool', 11), item('steer', 'a', 'user', 11), item('pending', '', 'user', 12)];
  assert.deepEqual(timeline({ items, turns }).map(entry => entry.key), ['input', 'turn:a', 'tool', 'steer', 'pending']);
});

test('与轮次开始同毫秒的追加消息保持在已经出现的输出之后', () => {
  const turns: Turn[] = [{ id: 'a', startedAt: 10, status: 'running' }];
  const items = [item('input', 'a', 'user', 10), item('tool', 'a', 'tool', 10), item('steer', 'a', 'user', 10)];
  assert.deepEqual(timeline({ items, turns }).map(entry => entry.key), ['input', 'turn:a', 'tool', 'steer']);
});
