import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Conversation, ConversationSummary } from './model.js';

/** 按父会话隔离记录，写入串行化并原子替换，浏览器刷新后仍可查看执行过程。 */
export class ConversationFiles {
  private readonly records = new Map<string, Conversation>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly directory: string, private readonly report: (error: unknown) => void) {}

  add(record: Conversation): void {
    this.records.set(record.id, record);
    this.changed(record);
  }

  changed(record: Conversation): void {
    record.revision++;
    record.updatedAt = Date.now();
    if (!this.timers.has(record.id)) {
      this.timers.set(record.id, setTimeout(() => {
        this.timers.delete(record.id);
        void this.save(record).catch(this.report);
      }, 300));
    }
  }

  async get(parent: string, id: string): Promise<Conversation> {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error('任务 ID 无效。');
    }
    const cached = this.records.get(id);
    if (cached) {
      if (cached.parentSessionId !== parent) {
        throw new Error('任务不属于当前会话。');
      }
      return cached;
    }
    const record = JSON.parse(await readFile(join(this.folder(parent), `${id}.json`), 'utf8')) as Conversation;
    const loaded = this.records.get(id);
    if (loaded) {
      if (loaded.parentSessionId !== parent) {
        throw new Error('任务不属于当前会话。');
      }
      return loaded;
    }
    if (record.version !== 1 || record.id !== id || record.parentSessionId !== parent || !Array.isArray(record.items) || !Array.isArray(record.turns)) {
      throw new Error('任务记录格式不受支持。');
    }
    if (record.status === 'starting' || record.status === 'running') {
      record.status = 'interrupted';
      record.error = 'DSH 上次退出时任务仍在运行，可以发送消息恢复原生会话。';
      for (const turn of record.turns) {
        if (turn.status === 'running') {
          turn.status = 'interrupted';
          turn.endedAt = record.updatedAt;
        }
      }
      for (const item of record.items) {
        if (item.status === 'running') {
          item.status = 'error';
        }
      }
    } else if (record.status === 'idle') {
      record.status = 'closed';
    }
    this.records.set(id, record);
    this.changed(record);
    return record;
  }

  async list(parent: string): Promise<ConversationSummary[]> {
    let filenames: string[];
    try {
      filenames = await readdir(this.folder(parent));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      filenames = [];
    }
    for (const filename of filenames) {
      if (/^[a-f0-9-]{36}\.json$/.test(filename)) {
        await this.get(parent, filename.slice(0, -5));
      }
    }
    return [...this.records.values()].filter(record => record.parentSessionId === parent).sort((a, b) => b.createdAt - a.createdAt).map(({ items: _items, turns, ...metadata }) => ({ ...metadata, turns: turns.length }));
  }

  async flush(): Promise<void> {
    const records = [...this.timers.keys()].map(id => this.records.get(id)!);
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    await Promise.all(records.map(record => this.save(record)));
    await Promise.all(this.writes.values());
  }

  private folder(parent: string): string {
    return join(this.directory, createHash('sha256').update(parent).digest('hex'));
  }

  private save(record: Conversation): Promise<void> {
    const previous = this.writes.get(record.id) ?? Promise.resolve();
    const snapshot = JSON.stringify(record);
    const task = previous.then(async () => {
      const folder = this.folder(record.parentSessionId);
      await mkdir(folder, { recursive: true });
      const filename = join(folder, `${record.id}.json`);
      await writeFile(`${filename}.tmp`, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(`${filename}.tmp`, filename);
    });
    // 某一次文件系统失败不阻止下一次保存；当前调用仍收到原始错误。
    this.writes.set(record.id, task.catch(this.report));
    return task;
  }
}
