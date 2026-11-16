import { randomUUID } from 'node:crypto';
import type { Conversation } from './model.js';
import { contentText } from './model.js';
import { createNative, SessionQueue } from './native.js';
import { Transcript } from './transcript.js';
import type { NativeSession, ProviderConfig, RunResult, StartRequest, Subprocess } from './host-types.js';
import { ConversationFiles } from './storage.js';

/** 官方提供方的有效设置，只在启动进程时读取，永不写入任务记录。 */
export interface ProviderSettings {
  backend: Conversation['backend'];
  config: ProviderConfig;
}

interface LiveConversation {
  record: Conversation;
  transcript: Transcript;
  native?: NativeSession;
  opening?: Promise<void>;
  closing?: Promise<void>;
  generation: number;
  first?: { settled: boolean; resolve: (result: RunResult) => void };
  detach?: () => void;
  queue: SessionQueue;
}

/** 将首次 DSH 委派和后续用户对话分别绑定到同一个原生会话。 */
export class Conversations {
  private readonly live = new Map<string, LiveConversation>();
  private disposed = false;

  constructor(readonly files: ConversationFiles, private readonly subprocess: Subprocess,
    private readonly settings: (provider: string) => ProviderSettings,
    private readonly report: (error: unknown) => void) {}

  async start(provider: string, request: StartRequest): Promise<{ id: string; result: Promise<RunResult>; dispose(): Promise<void> }> {
    request.signal.throwIfAborted();
    if (!request.prompt.length || request.prompt.some(block => block.type !== 'text') || !contentText(request.prompt).trim()) {
      throw new Error('外部子智能体只接受非空文本任务。');
    }
    const { backend, config } = this.settings(provider);
    const now = Date.now();
    const record: Conversation = {
      version: 1, id: randomUUID(), parentSessionId: request.parent.session.id, provider, backend,
      title: request.label || `${backend === 'codex' ? 'Codex' : 'Claude Code'} 子任务`, cwd: request.cwd,
      permissionMode: config.permissionMode ?? (backend === 'codex' ? 'never' : 'dontAsk'),
      status: 'starting', createdAt: now, updatedAt: now, revision: 0, items: [], turns: [],
    };
    this.files.add(record);
    const live = this.bind(record);
    const result = new Promise<RunResult>(resolve => { live.first = { settled: false, resolve }; });
    const abort = () => { void this.close(live).catch(this.report); };
    request.signal.addEventListener('abort', abort, { once: true });
    live.detach = () => request.signal.removeEventListener('abort', abort);
    const generation = live.generation;
    try {
      await live.queue.run(async () => {
        await this.open(live, generation);
        request.signal.throwIfAborted();
        this.check(live, generation);
        await this.sendRecord(live, contentText(request.prompt), randomUUID());
      });
    } catch (error) {
      if (live.generation === generation) {
        this.failed(live, error instanceof Error ? error : new Error(String(error)));
      }
      await live.closing;
      throw error;
    }
    return {
      id: record.id, result,
      dispose: async () => {
        live.detach?.();
        if (!live.first?.settled) {
          await this.close(live);
        }
        await live.closing;
      },
    };
  }

  async send(parent: string, id: string, message: string, requestId: string): Promise<void> {
    const record = await this.files.get(parent, id);
    const live = this.bind(record);
    const generation = live.generation;
    await live.queue.run(async () => {
      if (record.items.some(item => item.id === `user:${requestId}` && item.status !== 'error')) {
        return;
      }
      try {
        await this.open(live, generation);
        this.check(live, generation);
        await this.sendRecord(live, message, requestId);
      } catch (error) {
        if (generation === live.generation) {
          this.failed(live, error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    });
  }

  async interrupt(parent: string, id: string): Promise<void> {
    await this.files.get(parent, id);
    const live = this.live.get(id);
    if (live?.native) {
      await live.native.interrupt();
    }
  }

  async release(parent: string, id: string): Promise<void> {
    const record = await this.files.get(parent, id);
    const live = this.bind(record);
    await this.close(live);
  }

  async removeProvider(provider: string): Promise<void> {
    await Promise.all([...this.live.values()].filter(live => live.record.provider === provider).map(live => this.close(live)));
  }

  async expire(minutes: number): Promise<void> {
    const cutoff = Date.now() - minutes * 60_000;
    for (const live of this.live.values()) {
      if (live.native && live.record.status !== 'running' && live.record.status !== 'starting' && live.record.updatedAt < cutoff) {
        await this.close(live);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const results = await Promise.allSettled([...this.live.values()].map(live => this.close(live)));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.report(result.reason);
      }
    }
    await Promise.all([...this.live.values()].map(live => live.queue.drain()));
    await this.files.flush();
  }

  private bind(record: Conversation): LiveConversation {
    let live = this.live.get(record.id);
    if (!live) {
      live = { record, transcript: new Transcript(record, () => this.files.changed(record)), queue: new SessionQueue(), generation: 0 };
      this.live.set(record.id, live);
    }
    return live;
  }

  private async open(live: LiveConversation, generation: number): Promise<void> {
    await live.closing;
    this.check(live, generation);
    const { config, backend } = this.settings(live.record.provider);
    if (live.opening) {
      return live.opening;
    }
    if (live.native) {
      return Promise.resolve();
    }
    live.opening = (async () => {
      if (backend !== live.record.backend) {
        throw new Error('提供方类型已经改变，无法恢复已有原生会话。');
      }
      live.record.status = 'starting';
      live.record.permissionMode = config.permissionMode ?? (backend === 'codex' ? 'never' : 'dontAsk');
      delete live.record.error;
      this.files.changed(live.record);
      const native = await createNative({
        conversation: live.record, config, subprocess: this.subprocess, transcript: live.transcript,
        changed: () => this.files.changed(live.record),
        completed: result => {
          if (live.generation !== generation) {
            return;
          }
          if (live.first && !live.first.settled) {
            live.first.settled = true;
            live.first.resolve(result);
            live.detach?.();
          }
        },
        failed: error => {
          if (live.generation === generation) {
            this.failed(live, error);
          }
        },
      });
      try {
        this.check(live, generation);
        live.native = native;
        await native.open();
        this.check(live, generation);
      } catch (error) {
        await native.close();
        if (live.native === native) {
          live.native = undefined;
        }
        throw error;
      }
    })().finally(() => { live.opening = undefined; });
    return live.opening;
  }

  private async sendRecord(live: LiveConversation, message: string, requestId: string): Promise<void> {
    live.transcript.user(`user:${requestId}`, message);
    try {
      await live.native!.send(message);
    } catch (error) {
      const item = live.record.items.find(value => value.id === `user:${requestId}`)!;
      item.status = 'error';
      this.files.changed(live.record);
      throw error;
    }
  }

  private failed(live: LiveConversation, error: Error): void {
    if (live.closing || this.disposed) {
      return;
    }
    live.record.error = error.message;
    live.transcript.finish('error');
    if (live.first && !live.first.settled) {
      live.first.settled = true;
      live.first.resolve({ output: [], stopReason: 'error', diagnostic: '原生会话执行失败，请查看子智能体面板。' });
    }
    live.detach?.();
    this.report(error);
    void this.close(live, true).catch(this.report);
  }

  private check(live: LiveConversation, generation: number): void {
    if (this.disposed || live.generation !== generation) {
      throw new Error('原生会话启动或发送已取消。');
    }
  }

  private close(live: LiveConversation, preserveError = false): Promise<void> {
    if (live.closing) {
      return live.closing;
    }
    live.generation++;
    live.detach?.();
    const native = live.native;
    const opening = live.opening;
    live.native = undefined;
    if (live.record.status === 'running' || live.record.status === 'starting') {
      live.transcript.finish('interrupted');
    }
    if (live.first && !live.first.settled) {
      live.first.settled = true;
      live.first.resolve({ output: [], stopReason: 'aborted' });
    }
    live.closing = (async () => {
      const [closed] = await Promise.allSettled([native?.close(), opening]);
      if (!preserveError) {
        live.record.status = 'closed';
      }
      this.files.changed(live.record);
      if (closed.status === 'rejected') {
        throw closed.reason;
      }
    })().finally(() => { live.closing = undefined; });
    return live.closing;
  }
}
