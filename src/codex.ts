import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RpcChannel } from './line-channel.js';
import { object, text } from './model.js';
import { SessionQueue, type NativeOptions } from './native.js';
import type { NativeSession, ProcessHandle } from './host-types.js';

/** 使用官方 app-server 的持续线程；首次任务和侧边栏追加共享同一 threadId。 */
export class CodexSession implements NativeSession {
  private process?: ProcessHandle;
  private channel?: RpcChannel;
  private turnId?: string;
  private closing = false;
  private closed?: Promise<void>;
  private readonly queue = new SessionQueue();

  constructor(private readonly options: NativeOptions) {}

  async open(): Promise<void> {
    const { config, conversation, subprocess } = this.options;
    const permissions: Record<string, Record<string, unknown>> = {
      never: { approvalPolicy: 'never' },
      'approve-for-me': { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' },
      'dangerously-bypass-approvals-and-sandbox': { approvalPolicy: 'never', sandbox: 'danger-full-access' },
    };
    const permission = permissions[config.permissionMode ?? 'never'];
    if (!permission) {
      throw new Error(`无法识别 Codex 权限模式：${config.permissionMode}`);
    }
    const packagePath = createRequire(import.meta.url).resolve('@openai/codex/package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { bin: { codex: string } };
    this.process = subprocess.spawn({
      argv: [process.execPath, resolve(dirname(packagePath), manifest.bin.codex), 'app-server', '--stdio'],
      cwd: conversation.cwd, env: config.env, graceMs: config.disposeGraceMs ?? 3000,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    });
    if (!this.process.stdin || !this.process.stdout) {
      throw new Error('Codex 进程没有提供协议输入输出。');
    }
    this.channel = new RpcChannel(this.process.stdout, this.process.stdin, this.receive, error => { this.fail(error); });
    void this.process.done.then(outcome => {
      if (!this.closing) {
        this.fail(new Error(`Codex 进程已退出（${outcome.exitCode ?? outcome.signal ?? '未知状态'}）。`));
      }
    }, error => { this.fail(error instanceof Error ? error : new Error(String(error))); });
    await this.channel.request('initialize', { clientInfo: { name: 'dsh-subagent-panel', title: 'DSH 子智能体面板', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.channel.write({ method: 'initialized', params: {} });
    const response = await this.channel.request(conversation.nativeId ? 'thread/resume' : 'thread/start', {
      ...(conversation.nativeId ? { threadId: conversation.nativeId } : { ephemeral: false }),
      cwd: conversation.cwd, ...permission,
      ...(config.model ? { model: config.model } : {}),
    });
    const nativeId = text(object(response.thread).id);
    if (!nativeId) {
      throw new Error('Codex 没有返回原生线程 ID。');
    }
    conversation.nativeId = nativeId;
    conversation.model = text(response.model) || config.model;
    conversation.status = 'idle';
    this.options.changed();
  }

  send(message: string): Promise<void> {
    return this.queue.run(async () => {
      const channel = this.channel;
      if (!channel || this.closing) {
        throw new Error('Codex 会话已关闭。');
      }
      const threadId = this.options.conversation.nativeId;
      const input = [{ type: 'text', text: message }];
      if (this.turnId) {
        await channel.request('turn/steer', { threadId, expectedTurnId: this.turnId, input });
      } else {
        const response = await channel.request('turn/start', { threadId, input });
        const turn = object(response.turn);
        // 通知可能早于 RPC 响应；已结束的轮次不能被响应重新标成运行中。
        const known = this.options.conversation.turns.find(value => value.id === turn.id);
        if (!known || known.status === 'running') {
          this.turnId = text(turn.id);
          this.options.transcript.begin(this.turnId);
        }
      }
    });
  }

  async interrupt(): Promise<void> {
    if (this.turnId) {
      await this.channel!.request('turn/interrupt', { threadId: this.options.conversation.nativeId, turnId: this.turnId });
    }
  }

  close(): Promise<void> {
    if (this.closed) {
      return this.closed;
    }
    this.closing = true;
    this.channel?.close();
    this.process?.terminate();
    this.closed = (async () => { await this.process?.waitForExit(); })();
    return this.closed;
  }

  private fail(error: Error): void {
    if (!this.closing) {
      this.options.failed(error);
    }
  }

  private readonly receive = (method: string, params: Record<string, unknown>, id?: string | number): void => {
    const { conversation, transcript, changed, completed } = this.options;
    if (id !== undefined) {
      this.answerRequest(method, params, id);
      return;
    }
    if (params.threadId && params.threadId !== conversation.nativeId) {
      return;
    }
    if (method === 'turn/started') {
      this.turnId = text(object(params.turn).id);
    }
    transcript.codex(method, params);
    if (method === 'turn/completed') {
      const turn = object(params.turn);
      const status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'error';
      this.turnId = undefined;
      transcript.finish(status);
      const answer = transcript.answer();
      if (status === 'error') {
        conversation.error = text(object(turn.error).message) || 'Codex 本轮执行失败。';
        changed();
      }
      completed({ output: answer ? [{ type: 'text', text: answer }] : [], stopReason: status === 'completed' ? 'completed' : status === 'interrupted' ? 'aborted' : 'error', ...(conversation.error ? { diagnostic: conversation.error } : {}) });
    } else if (method === 'thread/tokenUsage/updated') {
      const usage = object(object(params.tokenUsage).last);
      const turn = conversation.turns.at(-1);
      if (turn) {
        turn.inputTokens = typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined;
        turn.outputTokens = typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined;
        changed();
      }
    } else if (method === 'error') {
      transcript.notice(text(object(params.error).message) || 'Codex 报告了错误。');
    }
  };

  private answerRequest(method: string, params: Record<string, unknown>, id: string | number): void {
    let result: Record<string, unknown> | undefined;
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const available = Array.isArray(params.availableDecisions) ? params.availableDecisions : [];
      result = { decision: available.includes('cancel') ? 'cancel' : 'decline' };
    } else if (method === 'item/permissions/requestApproval') {
      result = { permissions: {}, scope: 'turn' };
    } else if (method === 'item/tool/requestUserInput') {
      result = { answers: {} };
    } else if (method === 'mcpServer/elicitation/request') {
      result = { action: 'decline' };
    }
    if (result) {
      this.channel!.write({ id, result });
      this.options.transcript.notice('当前权限模式拒绝了原生交互请求，可在消息中补充说明。');
    } else {
      this.channel!.write({ id, error: { code: -32601, message: `不支持的原生请求：${method}` } });
      this.options.transcript.notice(`原生会话请求了未支持的能力：${method}`);
    }
  }
}
