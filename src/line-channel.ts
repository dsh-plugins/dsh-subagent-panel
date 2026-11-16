import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
import { object, text } from './model.js';

/** 按换行解码 JSON-RPC，保留 UTF-8 分片并隔离请求响应与通知。 */
export class JsonLines {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  constructor(private readonly receive: (value: Record<string, unknown>) => void) {}

  write(bytes: Buffer | string): void {
    this.pending += typeof bytes === 'string' ? bytes : this.decoder.write(bytes);
    let newline: number;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      if (newline > 32 * 1024 * 1024) {
        throw new Error('原生进程的单条消息超过 32 MiB。');
      }
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) {
        const value: unknown = JSON.parse(line);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('原生进程返回了无效的 JSON 消息。');
        }
        this.receive(value as Record<string, unknown>);
      }
    }
    if (this.pending.length > 32 * 1024 * 1024) {
      throw new Error('原生进程的单条消息超过 32 MiB。');
    }
  }

  end(): void {
    this.pending += this.decoder.end();
    if (this.pending.trim()) {
      this.write('\n');
    }
  }
}

/** 单个 Codex 进程的请求关联、超时和断线清理。 */
export class RpcChannel {
  private serial = 0;
  private closed = false;
  private readonly pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly lines: JsonLines;

  constructor(private readonly input: Readable, private readonly output: Writable,
    private readonly receive: (method: string, params: Record<string, unknown>, id?: string | number) => void,
    private readonly failed: (error: Error) => void) {
    this.lines = new JsonLines(value => {
      if (typeof value.method === 'string') {
        this.receive(value.method, object(value.params), typeof value.id === 'string' || typeof value.id === 'number' ? value.id : undefined);
        return;
      }
      const request = this.pending.get(String(value.id));
      if (!request) {
        return;
      }
      this.pending.delete(String(value.id));
      clearTimeout(request.timer);
      if (value.error) {
        request.reject(new Error(text(object(value.error).message) || 'Codex 请求失败。'));
      } else {
        request.resolve(object(value.result));
      }
    });
    input.on('data', this.onData);
    input.on('end', this.onEnd);
    input.on('error', this.onError);
    output.on('error', this.onError);
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error('原生会话连接已关闭。'));
    }
    const id = `panel-${++this.serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} 请求超时。`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  write(value: Record<string, unknown>): void {
    if (this.closed) {
      throw new Error('原生会话连接已关闭。');
    }
    this.output.write(`${JSON.stringify(value)}\n`, error => {
      if (error) {
        this.onError(error);
      }
    });
  }

  close(error = new Error('原生会话连接已关闭。')): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.input.off('data', this.onData);
    this.input.off('end', this.onEnd);
    // write 的回调可能先于 stream 的 error 事件；流关闭前必须继续接收错误。
    this.input.once('close', () => { this.input.off('error', this.onError); });
    this.output.once('close', () => { this.output.off('error', this.onError); });
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private readonly onData = (chunk: Buffer | string): void => {
    try {
      this.lines.write(chunk);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private readonly onEnd = (): void => {
    try {
      this.lines.end();
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.onError(new Error('原生进程关闭了协议输出。'));
  };

  private readonly onError = (error: Error): void => {
    if (!this.closed) {
      this.close(error);
      this.failed(error);
    }
  };
}
