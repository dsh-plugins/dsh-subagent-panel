import type { Conversation, TranscriptItem, Turn } from '../model.js';

interface TimelineEntry {
  time: number;
  key: string;
  item?: TranscriptItem;
  turn?: Turn;
  tail?: boolean;
}

/** 将消息、轮次标题与用量行合并为会话中的展示顺序。 */
export function timeline(task: Pick<Conversation, 'items' | 'turns'>): TimelineEntry[] {
  const turns = new Map(task.turns.map((turn, index) => [turn.id, { turn, index }]));
  const openingInputs = new Set<string>();
  const startedOutput = new Set<string>();
  for (const item of task.items) {
    if (item.kind === 'user' && !startedOutput.has(item.turn)) {
      openingInputs.add(item.id);
    } else if (item.kind !== 'user') {
      startedOutput.add(item.turn);
    }
  }
  const entries: TimelineEntry[] = [
    ...task.items.map(item => ({ time: item.time, key: item.id, item })),
    ...task.turns.flatMap(turn => [
      { time: turn.startedAt, key: `turn:${turn.id}`, turn, tail: false },
      ...(turn.endedAt !== undefined ? [{ time: turn.endedAt, key: `tail:${turn.id}`, turn, tail: true }] : []),
    ]),
  ];
  const order = (entry: TimelineEntry): [number, number] => {
    const owner = turns.get(entry.item?.turn ?? entry.turn!.id);
    const position = entry.item
      ? openingInputs.has(entry.item.id) && owner && entry.time <= owner.turn.startedAt ? 0 : 2
      : entry.tail ? 3 : 1;
    return [owner?.index ?? task.turns.length, position];
  };
  return entries.sort((a, b) => {
    const left = order(a), right = order(b);
    return a.time - b.time || left[0] - right[0] || left[1] - right[1];
  });
}
