import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { query, type Query, type SDKUserMessage, type SpawnedProcess, type SpawnOptions, type Options } from '@anthropic-ai/claude-agent-sdk';
import { InputQueue, type NativeOptions } from './native.js';
import { object, text } from './model.js';
import type { NativeSession, ProcessHandle } from './host-types.js';

/** 将 SDK 生命周期映射到宿主的进程树所有权，取消时等待整个执行范围退出。 */
class ClaudeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin;
  readonly stdout;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(readonly child: ProcessHandle, failed: (error: Error) => void) {
    super();
    if (!child.stdin || !child.stdout) {
      throw new Error('Claude Code 进程没有提供协议输入输出。');
    }
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.on('error', failed);
    void child.done.then(outcome => {
      this.exitCode = outcome.exitCode;
      this.signalCode = outcome.signal;
      this.emit('exit', outcome.exitCode, outcome.signal);
    }, error => { this.emit('error', error); });
  }

  kill(): boolean {
    this.killed = true;
    this.child.terminate();
    return true;
  }
}

/** 保持 SDK 输入流开放，让后续消息由同一 Claude 原生会话处理。 */
export class ClaudeSession implements NativeSession {
  private readonly input = new InputQueue<SDKUserMessage>();
  private readonly abort = new AbortController();
  private query?: Query;
  private child?: ProcessHandle;
  private reader?: Promise<void>;
  private closing = false;
  private closed?: Promise<void>;
  private interrupted = false;
  private readonly pending = new Set<string>();

  constructor(private readonly options: NativeOptions) {}

  async open(): Promise<void> {
    const { config, conversation } = this.options;
    const mode = config.permissionMode ?? 'dontAsk';
    if (!['dontAsk', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'].includes(mode)) {
      throw new Error(`无法识别 Claude Code 权限模式：${mode}`);
    }
    this.query = query({
      prompt: this.input,
      options: {
        cwd: conversation.cwd, env: { ...process.env, ...config.env },
        abortController: this.abort, persistSession: true, includePartialMessages: true,
        ...(conversation.nativeId ? { resume: conversation.nativeId } : {}),
        ...(config.model ? { model: config.model } : {}),
        permissionMode: mode as Options['permissionMode'],
        ...(mode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        disallowedTools: mode === 'plan' ? ['AskUserQuestion', 'ExitPlanMode'] : ['AskUserQuestion'],
        canUseTool: async () => {
          this.options.transcript.notice('当前权限模式拒绝了工具权限请求，可在消息中补充说明。');
          return { behavior: 'deny', message: '沿用 DSH 官方子智能体的非交互权限策略。' };
        },
        onElicitation: async () => ({ action: 'decline' }),
        onUserDialog: async () => ({ behavior: 'cancelled' }),
        supportedDialogKinds: ['refusal_fallback_prompt'],
        spawnClaudeCodeProcess: options => this.spawn(options),
      },
    });
    this.reader = this.consume(this.query);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([this.query.initializationResult(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('Claude Code 初始化超时。')); }, 30_000);
      })]);
    } finally {
      clearTimeout(timer);
    }
    if (conversation.status === 'starting') {
      conversation.status = 'idle';
      this.options.changed();
    }
  }

  async send(message: string): Promise<void> {
    if (!this.query || this.closing) {
      throw new Error('Claude Code 会话已关闭。');
    }
    const id = randomUUID();
    if (this.pending.size === 0) {
      this.options.transcript.begin(id);
    }
    this.pending.add(id);
    this.input.push({ type: 'user', session_id: this.options.conversation.nativeId ?? '', parent_tool_use_id: null, uuid: id, message: { role: 'user', content: message } });
  }

  async interrupt(): Promise<void> {
    if (!this.pending.size) {
      return;
    }
    this.interrupted = true;
    await this.query?.interrupt();
  }

  close(): Promise<void> {
    if (this.closed) {
      return this.closed;
    }
    this.closing = true;
    this.input.close();
    this.query?.close();
    this.child?.terminate();
    this.closed = (async () => {
      await this.child?.waitForExit();
      await this.reader;
    })();
    return this.closed;
  }

  private spawn(options: SpawnOptions): SpawnedProcess {
    // 宿主负责清除继承凭据，仅恢复明确配置的环境值及 SDK 实际改写的项。
    const env: NodeJS.ProcessEnv = { ...this.options.config.env };
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== process.env[key]) {
        env[key] = value;
      }
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in options.env)) {
        env[key] = undefined;
      }
    }
    this.child = this.options.subprocess.spawn({
      argv: [options.command, ...options.args], cwd: options.cwd ?? this.options.conversation.cwd,
      env, signal: options.signal, graceMs: this.options.config.disposeGraceMs ?? 3000,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    });
    return new ClaudeProcess(this.child, error => {
      if (!this.closing) {
        this.options.failed(error);
      }
    });
  }

  private async consume(stream: Query): Promise<void> {
    const { conversation, transcript, changed, completed, failed } = this.options;
    try {
      for await (const message of stream) {
        if (this.closing) {
          break;
        }
        if ('session_id' in message && message.session_id) {
          conversation.nativeId = message.session_id;
        }
        if (message.type === 'system' && message.subtype === 'init') {
          conversation.model = message.model;
          changed();
        }
        transcript.claude(message as unknown as Record<string, unknown>);
        if (message.type === 'result') {
          const status = message.terminal_reason === 'aborted_streaming' || message.terminal_reason === 'aborted_tools' || (!message.terminal_reason && this.interrupted)
            ? 'interrupted' : message.subtype === 'success' && !message.is_error ? 'completed' : 'error';
          this.interrupted = false;
          transcript.finish(status, { input: message.usage.input_tokens, output: message.usage.output_tokens });
          const answer = message.subtype === 'success' ? message.result : transcript.answer();
          if (message.subtype === 'success' && answer && !transcript.answer()) {
            transcript.claude({ type: 'assistant', message: { id: message.uuid, content: [{ type: 'text', text: answer }] } });
          }
          if (status === 'error') {
            conversation.error = message.subtype === 'success' ? message.result : message.errors.join('\n');
          }
          completed({ output: answer ? [{ type: 'text', text: answer }] : [], stopReason: status === 'completed' ? 'completed' : status === 'interrupted' ? 'aborted' : 'error', ...(conversation.error ? { diagnostic: conversation.error } : {}) });
          const consumed = message.user_message_uuids ?? [message.user_message_uuid ?? this.pending.values().next().value];
          for (const id of consumed) {
            if (id) {
              this.pending.delete(id);
            }
          }
          if (this.pending.size > 0) {
            transcript.begin(this.pending.values().next().value!);
          }
          changed();
        } else if (message.type === 'system' && message.subtype === 'permission_denied') {
          transcript.notice('Claude Code 根据当前权限配置拒绝了操作。');
        } else if (message.type === 'system' && message.subtype === 'api_retry') {
          transcript.notice(`Claude Code 正在重试请求：${text(object(message).error) || '等待服务响应'}`);
        }
      }
      if (!this.closing) {
        failed(new Error('Claude Code 原生会话已结束。'));
      }
    } catch (error) {
      if (!this.closing) {
        failed(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
