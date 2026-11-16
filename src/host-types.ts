import type { Readable, Writable, Duplex } from 'node:stream';
import type { CordisContext } from '@dsh-plugin/dsh-loader';

/** 只声明本插件使用的宿主公开接口，服务实例由 dsh-loader 提供。 */
export interface HostContext extends CordisContext {
  readonly registry: PluginRegistry;
  on(event: string, callback: (...args: any[]) => void): () => void;
}

/** 官方提供方启动配置，环境变量只在原生进程创建时使用。 */
export interface ProviderConfig {
  providerName?: string;
  model?: string;
  env?: Record<string, string>;
  permissionMode?: string;
  disposeGraceMs?: number;
}

/** Cordis 的公开运行实例及其已生效配置。 */
export interface PluginRegistry {
  values(): Iterable<{ name?: string; fibers: Iterable<{ state: number; effectiveConfig: unknown }> }>;
}

/** 官方提供方接收的已解析委派，仅使用文本输入和父会话身份。 */
export interface StartRequest {
  cwd: string;
  label?: string;
  prompt: { type: string; text?: string }[];
  parent: { session: { id: string } };
  signal: AbortSignal;
}

/** 首轮结果沿官方子智能体通道返回主任务。 */
export interface RunResult {
  output: { type: 'text'; text: string }[];
  stopReason: 'completed' | 'aborted' | 'error';
  diagnostic?: string;
}

/** 保留原提供方对象身份，使卸载面板可以恢复其执行入口。 */
export interface Provider {
  name: string;
  start?(request: StartRequest): Promise<{ id: string; result: Promise<RunResult>; dispose(): Promise<void> }>;
}

/** 通过提供方注册表确认目标仍由宿主管理。 */
export interface Subagents {
  getProvider(name: string): Provider | undefined;
}

/** 原生 CLI 使用宿主管理的输入输出、环境隔离及取消范围。 */
export interface SpawnSpec {
  argv: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  graceMs: number;
  stdio: { stdin: 'pipe'; stdout: 'pipe'; stderr: 'pipe' | 'inherit' };
}

/** 进程关闭需要等待宿主确认整个执行范围退出。 */
export interface ProcessHandle {
  stdin?: Writable;
  stdout?: Readable;
  stderr?: Readable;
  control?: Duplex;
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  terminate(): void;
  waitForExit(signal?: AbortSignal): Promise<boolean>;
}

/** 保持所有原生进程处于 DSH 的进程所有权管理中。 */
export interface Subprocess {
  spawn(spec: SpawnSpec): ProcessHandle;
}

/** 每个面板独占原生连接；委派只持有首轮结果，插件持有后续会话。 */
export interface NativeSession {
  open(): Promise<void>;
  send(message: string): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
