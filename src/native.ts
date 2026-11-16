import type { Conversation } from './model.js';
import type { NativeSession, ProviderConfig, RunResult, Subprocess } from './host-types.js';
import type { Transcript } from './transcript.js';

/** 原生驱动只发布展示事件与轮次结果，不直接处理 HTTP 或持久化。 */
export interface NativeOptions {
  conversation: Conversation;
  config: ProviderConfig;
  subprocess: Subprocess;
  transcript: Transcript;
  changed(): void;
  completed(result: RunResult): void;
  failed(error: Error): void;
}

/** 多次 send 串行进入原生连接，避免启动与追加争抢同一个轮次。 */
export class SessionQueue {
  private tail: Promise<void> = Promise.resolve();

  run(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    // 错误由返回的 result 交给调用方，队列仅等待结束，避免一次失败阻断后续消息。
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  drain(): Promise<void> {
    return this.tail;
  }
}

/** 流式输入队列只在释放会话时结束，单轮完成不关闭 Claude 的 stdin。 */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private wake?: () => void;
  private ended = false;

  push(value: T): void {
    if (this.ended) {
      throw new Error('原生会话输入已关闭。');
    }
    this.values.push(value);
    this.wake?.();
  }

  close(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.ended) {
      if (!this.values.length) {
        await new Promise<void>(resolve => { this.wake = resolve; });
        this.wake = undefined;
      }
      while (!this.ended && this.values.length) {
        yield this.values.shift()!;
      }
    }
  }
}

export async function createNative(options: NativeOptions): Promise<NativeSession> {
  if (options.conversation.backend === 'codex') {
    const { CodexSession } = await import('./codex.js');
    return new CodexSession(options);
  }
  const { ClaudeSession } = await import('./claude.js');
  return new ClaudeSession(options);
}
