/** 宿主与侧边栏共享的可持久化展示数据，不包含凭据或原始进程环境。 */
export interface Conversation {
  version: 1;
  id: string;
  parentSessionId: string;
  provider: string;
  backend: 'codex' | 'claude-code';
  title: string;
  cwd: string;
  nativeId?: string;
  model?: string;
  permissionMode: string;
  status: 'starting' | 'running' | 'idle' | 'interrupted' | 'error' | 'closed';
  createdAt: number;
  updatedAt: number;
  revision: number;
  items: TranscriptItem[];
  turns: Turn[];
  error?: string;
}

/** 协议事件按稳定 ID 合并，流式增量和最终快照共用一个展示节点。 */
export interface TranscriptItem {
  id: string;
  turn: string;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'notice';
  title?: string;
  text: string;
  input?: string;
  phase?: string;
  status?: 'running' | 'completed' | 'error';
  time: number;
}

/** 单轮状态独立于进程状态，结束的轮次仍可保留一个待续聊的原生进程。 */
export interface Turn {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'interrupted' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}

/** 列表请求只传元数据，完整执行输出按任务读取。 */
export type ConversationSummary = Omit<Conversation, 'items' | 'turns'> & { turns: number };

export const API = '/_dsh/subagent-panel';
export const PACKAGE = '@dsh-plugin/dsh-subagent-panel';

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function display(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

export function contentText(value: unknown): string {
  if (!Array.isArray(value)) {
    return text(value);
  }
  return value.map(block => text(object(block).text) || (object(block).type === 'image' ? '[图片]' : '')).filter(Boolean).join('\n');
}
