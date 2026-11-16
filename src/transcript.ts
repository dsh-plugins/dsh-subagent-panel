import { contentText, display, object, text, type Conversation, type TranscriptItem, type Turn } from './model.js';

/** 将两种原生协议折叠成稳定的消息节点，最终事件覆盖已有增量。 */
export class Transcript {
  private readonly items = new Map<string, TranscriptItem>();
  private readonly messages = new Map<string, string>();
  private readonly blocks = new Map<string, string>();
  private readonly snapshots = new Set<string>();
  private readonly finalized = new Set<string>();
  private currentTurn = '';

  constructor(readonly conversation: Conversation, private readonly changed: () => void) {
    for (const item of conversation.items) {
      this.items.set(item.id, item);
    }
  }

  user(id: string, message: string): void {
    this.put(id, { kind: 'user', text: message, status: 'completed', turn: this.conversation.status === 'running' ? this.currentTurn : '' });
  }

  notice(message: string, id = `notice:${this.conversation.items.length}`): void {
    this.put(id, { kind: 'notice', text: message });
  }

  begin(id: string): void {
    this.currentTurn = id;
    for (const item of this.conversation.items) {
      if (item.kind === 'user' && !item.turn) {
        item.turn = id;
      }
    }
    if (!this.conversation.turns.some(turn => turn.id === id)) {
      this.conversation.turns.push({ id, startedAt: Date.now(), status: 'running' });
    }
    this.conversation.status = 'running';
    delete this.conversation.error;
    this.changed();
  }

  finish(status: Turn['status'], usage?: { input?: number; output?: number }): void {
    const turn = this.conversation.turns.find(value => value.id === this.currentTurn);
    if (turn) {
      turn.status = status;
      turn.endedAt = Date.now();
      turn.inputTokens = usage?.input ?? turn.inputTokens;
      turn.outputTokens = usage?.output ?? turn.outputTokens;
    }
    for (const item of this.items.values()) {
      if (item.turn === this.currentTurn && item.status === 'running') {
        item.status = status === 'completed' ? 'completed' : 'error';
      }
    }
    this.conversation.status = status === 'completed' ? 'idle' : status === 'running' ? 'running' : status;
    this.changed();
  }

  answer(): string {
    const messages = this.conversation.items.filter(item => item.kind === 'assistant' && item.turn === this.currentTurn);
    return messages.findLast(item => item.phase === 'final_answer')?.text
      ?? messages.filter(item => item.phase !== 'commentary').map(item => item.text).join('\n\n');
  }

  codex(method: string, params: Record<string, unknown>): void {
    if (method === 'turn/started') {
      this.begin(text(object(params.turn).id));
      return;
    }
    const item = object(params.item);
    const id = text(item.id) || text(params.itemId);
    if (!id) {
      return;
    }
    if (method === 'item/started' || method === 'item/completed') {
      const completed = method === 'item/completed';
      const status = completed ? (item.status === 'failed' || item.status === 'declined' ? 'error' : 'completed') : 'running';
      switch (item.type) {
        case 'agentMessage':
          this.put(id, { kind: 'assistant', text: text(item.text), phase: text(item.phase), status });
          break;
        case 'reasoning': {
          const summary = Array.isArray(item.summary) ? item.summary.map(value => text(object(value).text) || text(value)).join('\n') : '';
          const content = Array.isArray(item.content) ? item.content.map(value => text(object(value).text) || text(value)).join('\n') : '';
          this.put(id, { kind: 'reasoning', text: summary || content || this.items.get(id)?.text || '', status });
          break;
        }
        case 'commandExecution':
          this.put(id, { kind: 'tool', title: '执行命令', input: text(item.command), text: text(item.aggregatedOutput) || this.items.get(id)?.text || '', status: typeof item.exitCode === 'number' && item.exitCode !== 0 ? 'error' : status });
          break;
        case 'fileChange':
          this.put(id, { kind: 'tool', title: '修改文件', input: display(item.changes), text: this.items.get(id)?.text || '', status });
          break;
        case 'mcpToolCall':
        case 'dynamicToolCall':
          this.put(id, { kind: 'tool', title: [text(item.server), text(item.tool)].filter(Boolean).join(' / ') || '工具调用', input: display(item.arguments), text: display(item.result ?? item.content ?? item.error), status });
          break;
        case 'webSearch':
          this.put(id, { kind: 'tool', title: '搜索网页', input: text(item.query), text: display(item.action), status });
          break;
        case 'plan':
          this.put(id, { kind: 'assistant', title: '计划', text: text(item.text), status });
          break;
        case 'userMessage':
          break;
        default:
          this.put(id, { kind: 'tool', title: text(item.type) || '执行记录', text: display(item), status });
      }
      return;
    }
    if (method.endsWith('/delta') || method.endsWith('Delta')) {
      const kind = method.includes('reasoning') ? 'reasoning' : method.includes('agentMessage') || method.includes('/plan/') ? 'assistant' : 'tool';
      const previous = this.items.get(id);
      this.put(id, { kind, text: (previous?.text ?? '') + text(params.delta), status: 'running' });
    }
  }

  claude(message: Record<string, unknown>): void {
    const scope = text(message.parent_tool_use_id);
    if (message.type === 'stream_event') {
      const event = object(message.event);
      if (event.type === 'message_start') {
        this.messages.set(scope, text(object(event.message).id));
      }
      const messageId = this.messages.get(scope) || text(message.uuid);
      const streamKey = `${scope}:${messageId}:${event.index ?? 0}`;
      let key = this.blocks.get(streamKey) ?? streamKey;
      if (event.type === 'content_block_start') {
        const block = object(event.content_block);
        key = block.type === 'tool_use' ? `tool:${text(block.id)}` : streamKey;
        this.blocks.set(streamKey, key);
        this.claudeBlock(key, block, false);
      } else if (event.type === 'content_block_delta') {
        const delta = object(event.delta);
        const previous = this.items.get(key);
        if (delta.type === 'input_json_delta') {
          this.put(key, { kind: 'tool', input: (previous?.input === '{}' ? '' : previous?.input ?? '') + text(delta.partial_json), text: previous?.text ?? '', status: 'running' });
        } else if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
          this.put(key, { kind: delta.type === 'thinking_delta' ? 'reasoning' : 'assistant', text: (previous?.text ?? '') + text(delta.text ?? delta.thinking), status: 'running' });
        }
      }
      return;
    }
    if (message.type === 'assistant') {
      const snapshot = text(message.uuid);
      if (snapshot && this.snapshots.has(snapshot)) {
        return;
      }
      if (snapshot) {
        this.snapshots.add(snapshot);
      }
      const body = object(message.message);
      const blocks = Array.isArray(body.content) ? body.content : [];
      const prefix = `${scope}:${text(body.id)}:`;
      for (let index = 0; index < blocks.length; index++) {
        const block = object(blocks[index]);
        const kind = block.type === 'thinking' ? 'reasoning' : 'assistant';
        const streamed = [...this.blocks.entries()].find(([streamKey, key]) => streamKey.startsWith(prefix) && !this.finalized.has(key) && this.items.get(key)?.kind === kind);
        // SDK 的 assistant 事件可能只包含刚结束的单个块，其数组下标不是流的 block index。
        const key = block.type === 'tool_use' ? `tool:${text(block.id)}` : streamed?.[1] ?? `${prefix}${snapshot || 'snapshot'}:${index}`;
        this.claudeBlock(key, block, true);
        this.finalized.add(key);
      }
    } else if (message.type === 'user') {
      const blocks = object(message.message).content;
      if (Array.isArray(blocks)) {
        for (const value of blocks) {
          const block = object(value);
          if (block.type === 'tool_result') {
            const toolId = text(block.tool_use_id);
            this.put(`tool:${toolId}`, { kind: 'tool', text: contentText(block.content) || display(block.content), status: block.is_error ? 'error' : 'completed' });
          }
        }
      }
    } else if (message.type === 'tool_progress') {
      const toolId = text(message.tool_use_id);
      const entry = this.items.get(`tool:${toolId}`);
      if (entry) {
        this.put(entry.id, { ...entry, title: `${text(message.tool_name) || entry.title} · ${message.elapsed_time_seconds ?? 0}s` });
      }
    }
  }

  private claudeBlock(key: string, block: Record<string, unknown>, complete: boolean): void {
    if (block.type === 'text' || block.type === 'thinking') {
      this.put(key, { kind: block.type === 'text' ? 'assistant' : 'reasoning', text: text(block.text ?? block.thinking), status: complete ? 'completed' : 'running' });
    } else if (block.type === 'tool_use') {
      this.put(key, { kind: 'tool', title: text(block.name), input: display(block.input), text: this.items.get(key)?.text ?? '', status: this.items.get(key)?.status ?? 'running' });
    }
  }

  private put(id: string, values: Partial<TranscriptItem> & Pick<TranscriptItem, 'kind' | 'text'>): TranscriptItem {
    let item = this.items.get(id);
    if (item) {
      Object.assign(item, values);
    } else {
      item = { id, turn: this.currentTurn, time: Date.now(), ...values };
      this.items.set(id, item);
      this.conversation.items.push(item);
    }
    this.changed();
    return item;
  }
}
