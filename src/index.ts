import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig } from '@dsh-plugin/dsh-loader/config';
import type { HostAPI } from '@dsh-plugin/dsh-loader';
import { PACKAGE, object } from './model.js';
import type { HostContext, Provider, ProviderConfig, Subagents, Subprocess } from './host-types.js';
import { ConversationFiles } from './storage.js';
import { Conversations, type ProviderSettings } from './conversations.js';
import { registerHttp } from './http.js';

export const name = PACKAGE;
export const inject = ['dshLoader', 'subagents', 'subprocess', 'connection'];

/** 复用官方提供方名称和有效配置，仅替换其执行入口；禁用时自动恢复。 */
export async function apply(ctx: HostContext): Promise<void> {
  const loader = ctx.get('dshLoader') as HostAPI;
  const subagents = loader.services.get('subagents') as Subagents;
  const registry = ctx.registry;
  const subprocess = loader.services.get('subprocess') as Subprocess;
  const report = (error: unknown) => { console.error('[dsh-subagent-panel]', error); };
  const handle = await loader.config.register<{ idleMinutes: number }>(ctx, defineConfig({
    id: 'dsh-subagent-panel', packageName: name, title: '外部子智能体面板',
    description: '接入官方 Codex 和 Claude Code 子智能体，保留原生会话以供侧边栏继续对话。',
    fields: [{ type: 'number', key: 'idleMinutes', label: '空闲进程保留时间（分钟）', default: 30, min: 1, max: 1440, description: '超过此时间释放进程；再次发送消息时从原生历史恢复。' }],
  }));
  function providers(): Map<string, ProviderSettings> {
    const result = new Map<string, ProviderSettings>();
    for (const runtime of registry.values()) {
      const backend = runtime.name === 'subagent-codex' || runtime.name === '@deepseek-ai/dsh-subagent-codex' ? 'codex'
        : runtime.name === 'subagent-claude-code' || runtime.name === '@deepseek-ai/dsh-subagent-claude-code' ? 'claude-code' : undefined;
      if (!backend) {
        continue;
      }
      for (const fiber of runtime.fibers) {
        if (fiber.state !== 1 && fiber.state !== 2) {
          continue;
        }
        const config = object(fiber.effectiveConfig) as ProviderConfig;
        result.set(config.providerName ?? backend, { backend, config });
      }
    }
    return result;
  }
  const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME.replace(/^~(?=[\\/]|$)/, homedir())) : join(homedir(), '.dsh');
  const files = new ConversationFiles(join(home, 'data', 'dsh-subagent-panel'), report);
  const conversations = new Conversations(files, subprocess, provider => {
    const settings = providers().get(provider);
    if (!settings || !subagents.getProvider(provider)) {
      throw new Error(`请先启用对应的官方子智能体插件：${provider}`);
    }
    return settings;
  }, report);
  const patched = new WeakSet<Provider>();
  const attach = (provider: Provider) => {
    if (!provider.start || patched.has(provider) || !providers().has(provider.name)) {
      return;
    }
    loader.patch.method(provider, 'start', () => request => conversations.start(provider.name, request), { id: `${name}:${provider.name}`, owner: ctx });
    patched.add(provider);
  };
  ctx.on('subagent/provider-added', attach);
  ctx.on('subagent/provider-removed', (provider: string) => {
    void conversations.removeProvider(provider).catch(report);
  });
  for (const provider of providers().keys()) {
    const registered = subagents.getProvider(provider);
    if (registered) {
      attach(registered);
    }
  }
  ctx.effect(() => registerHttp(loader, conversations), 'subagent-panel:http');
  ctx.effect(() => {
    const timer = setInterval(() => { void conversations.expire(handle.get().value.idleMinutes).catch(report); }, 60_000);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await conversations.dispose();
    };
  }, 'subagent-panel:sessions');
}
