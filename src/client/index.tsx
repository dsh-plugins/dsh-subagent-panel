import * as React from 'react';
import { Scrollbar, Markdown, type DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
import { PACKAGE, type Conversation, type ConversationSummary, type TranscriptItem, type Turn } from '../model.js';
import { endpoint, parseResource, request, resource, usePolling } from './api.js';
import { styles } from './style.js';

export const name = PACKAGE;
export const inject = ['dshLoaderUi', 'slots', 'sidebarRight', 'sidebarRightTabs'];

interface ClientContext {
  dshLoaderUi: DshLoaderUi;
  effect(effect: () => (() => void), label?: string): unknown;
}
interface Slots {
  inject(name: string, callback: () => (() => void)): () => void;
  register(options: { name: string; id?: string; key?: string; order?: number }, component: React.ComponentType<any>): () => void;
}
interface Sidebar {
  openResource(address: string, options: { kind: string; preferNewPane?: boolean }): void;
}
interface Tabs {
  register(options: { id: string; kind: string; keepMounted: boolean; patterns: string[]; title(address: string): string; canOpen(address: string): boolean }): () => void;
}

/** 通过官方槽位注册右侧标签页，以及会话标题栏和原生子智能体菜单入口。 */
export function apply(ctx: ClientContext): void {
  const service = <T,>(key: string): T => {
    const value = ctx.dshLoaderUi.services?.get(key);
    if (!value) {
      throw new Error(`子智能体面板缺少客户端服务：${key}`);
    }
    return value as T;
  };
  const slots = service<Slots>('slots');
  const sidebar = service<Sidebar>('sidebarRight');
  const tabs = service<Tabs>('sidebarRightTabs');
  const open = (parent: string, task?: ConversationSummary) => sidebar.openResource(resource(parent, task?.id, task?.title), { kind: 'external-subagent', preferNewPane: false });
  function Launcher({ sessionId }: { sessionId: string }): React.ReactElement {
    const { value, error } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(sessionId));
    const count = value?.tasks.filter(task => task.status === 'running' || task.status === 'starting').length ?? 0;
    return <button type="button" className="dsp-button dsp-launcher" onClick={() => { open(sessionId); }} title={error || '在侧边栏查看 Codex 和 Claude Code 的执行过程'}>
      <span aria-hidden="true">◫</span> 外部子智能体 <span className="dsp-count">{count || value?.tasks.length || 0}</span>
    </button>;
  }
  function Footer({ sessionId }: { sessionId: string }): React.ReactElement | null {
    const { value } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(sessionId));
    if (!value?.tasks.length) {
      return null;
    }
    return <div className="dsp-footer">{value.tasks.slice(0, 6).map(task => <button key={task.id} type="button" className="dsp-button" onClick={() => { open(sessionId, task); }}>
      <span className={`dsp-dot ${task.status}`} />{task.title}<span className="dsp-meta">{statusLabel(task.status)}</span>
    </button>)}<button type="button" className="dsp-button" onClick={() => { open(sessionId); }}>查看全部外部子智能体</button></div>;
  }
  function Tab({ useTabInfo }: { useTabInfo(): { tab: { contentId: string } } }): React.ReactElement {
    const { tab } = useTabInfo();
    const address = parseResource(tab.contentId);
    if (!address) {
      return <div className="dsp-empty">子智能体地址无效。</div>;
    }
    return address.id === 'list' ? <TaskList parent={address.parent} open={task => { open(address.parent, task); }} /> : <TaskPanel key={tab.contentId} parent={address.parent} id={address.id} />;
  }
  ctx.effect(() => {
    const element = document.createElement('style');
    element.dataset.pluginCss = name;
    element.textContent = styles;
    document.head.appendChild(element);
    return () => { element.remove(); };
  }, 'subagent-panel:styles');
  ctx.effect(() => tabs.register({ id: name, kind: 'external-subagent', keepMounted: true, patterns: ['dsh-resource://external-subagent/**'], title: address => parseResource(address)?.title || '外部子智能体', canOpen: address => !!parseResource(address) }), 'subagent-panel:tabs');
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: name }, Tab)), 'subagent-panel:body');
  ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: name, order: 11 }, Launcher)), 'subagent-panel:launcher');
  ctx.effect(() => slots.inject('conversation.session.header.actions.subagent.footer', () => slots.register({ name: 'conversation.session.header.actions.subagent.footer', id: name }, Footer)), 'subagent-panel:catalog');
}

function TaskList({ parent, open }: { parent: string; open(task: ConversationSummary): void }): React.ReactElement {
  const { value, error, refresh } = usePolling<{ tasks: ConversationSummary[] }>(endpoint(parent));
  return <section className="dsp-panel" aria-label="外部子智能体列表">
    <div className="dsp-toolbar"><div className="dsp-heading"><strong>外部子智能体</strong><span className="dsp-meta">Codex · Claude Code</span></div><button className="dsp-button" onClick={refresh} type="button">刷新</button></div>
    {error && <div className="dsp-error" role="alert">{error}</div>}
    <Scrollbar className="dsp-scroll"><div className="dsp-content">{value?.tasks.map(task => <button type="button" className="dsp-task" key={task.id} onClick={() => { open(task); }}>
      <div className="dsp-meta"><span>{backendLabel(task.backend)}</span><span><span className={`dsp-dot ${task.status}`} />{statusLabel(task.status)}</span></div>
      <strong>{task.title}</strong><div className="dsp-meta"><span>{task.turns} 轮对话</span><time>{new Date(task.createdAt).toLocaleString('zh-CN')}</time></div>
    </button>)}{!error && !value?.tasks.length && <div className="dsp-empty"><strong>{value ? '等待外部子智能体任务' : '正在加载任务…'}</strong>{value && <>在当前会话中调用 Codex 或 Claude Code 子智能体后，任务会自动出现在这里。</>}</div>}</div></Scrollbar>
  </section>;
}

function TaskPanel({ parent, id }: { parent: string; id: string }): React.ReactElement {
  const { value: task, error, refresh } = usePolling<Conversation>(endpoint(parent, id));
  const [draft, setDraft] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [follow, setFollow] = React.useState(true);
  const sendId = React.useRef(crypto.randomUUID());
  const root = React.useRef<HTMLDivElement>(null);
  const abort = React.useRef(new AbortController());
  React.useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => { controller.abort(); };
  }, []);
  React.useLayoutEffect(() => {
    const viewport = root.current?.querySelector('.dshl-scrollbar-viewport');
    if (follow && viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [task?.revision, follow]);
  const operate = async (operation: string) => {
    setWorking(true);
    setActionError('');
    try {
      await request(endpoint(parent, id, operation), abort.current.signal, operation === 'send' ? { message: draft, requestId: sendId.current } : {});
      if (!abort.current.signal.aborted) {
        if (operation === 'send') {
          setDraft('');
          sendId.current = crypto.randomUUID();
          setFollow(true);
        }
        refresh();
      }
    } catch (failure) {
      if (!abort.current.signal.aborted) {
        setActionError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (!abort.current.signal.aborted) {
        setWorking(false);
      }
    }
  };
  return <section className="dsp-panel" aria-label="外部子智能体对话">
    <div className="dsp-toolbar"><div className="dsp-heading"><strong>{task?.title || '正在加载…'}</strong><div className="dsp-meta"><span className={`dsp-dot ${task?.status}`} />{task && `${backendLabel(task.backend)} · ${statusLabel(task.status)}`}</div></div>
      <button type="button" className="dsp-button" disabled={working || !task || task.status === 'closed'} onClick={() => { void operate('release'); }} title="释放原生进程，保留历史以便再次发送消息恢复">释放进程</button>
    </div>
    {(error || actionError || task?.error) && <div className="dsp-error" role="alert">{actionError || error || task?.error}<button type="button" className="dsp-button" onClick={refresh}>刷新</button></div>}
    <div ref={root} style={{ display: 'flex', flex: 1, minHeight: 0 }} onScrollCapture={event => {
      const element = event.target as HTMLElement;
      if (element.classList.contains('dshl-scrollbar-viewport')) {
        setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 60);
      }
    }}><Scrollbar className="dsp-scroll"><div className="dsp-content">{task && <Timeline task={task} />}
      {task?.status === 'starting' && <div className="dsp-meta" role="status">正在连接原生会话…</div>}
    </div></Scrollbar></div>
    {!follow && <button type="button" className="dsp-button dsp-follow" onClick={() => { setFollow(true); }}>↓ 查看最新输出</button>}
    <form className="dsp-composer" onSubmit={event => { event.preventDefault(); if (draft.trim() && !working) { void operate('send'); } }}>
      <textarea className="dsp-input" aria-label="发送给子智能体的消息" placeholder="向这个子智能体追加消息…" value={draft} onChange={event => { setDraft(event.target.value); sendId.current = crypto.randomUUID(); }} disabled={working || !task} maxLength={100000}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.trim() && !working) { void operate('send'); } } }} />
      <div className="dsp-compose-actions"><span className="dsp-hint">{task?.model || (task ? backendLabel(task.backend) : '')}<br />{task?.status === 'closed' ? '发送后恢复原生会话' : task?.backend === 'claude-code' && task.status === 'running' ? '立即提交，Claude 原生队列接续处理' : 'Enter 发送 · Shift+Enter 换行'}</span><span style={{ display: 'flex', gap: 8 }}>
        {task?.status === 'running' && <button type="button" className="dsp-button" disabled={working} onClick={() => { void operate('interrupt'); }}>停止当前轮次</button>}
        <button type="submit" className="dsp-button dsp-send" disabled={working || !task || !draft.trim()}>{working ? '处理中…' : '发送 ↑'}</button>
      </span></div>
    </form>
  </section>;
}

function Item({ item }: { item: TranscriptItem }): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState<boolean>();
  const open = expanded ?? item.status === 'running';
  if (item.kind === 'reasoning' && !item.text && item.status !== 'running') {
    return null;
  }
  if (item.kind === 'tool' || item.kind === 'reasoning') {
    return <details className="dsp-item dsp-detail" open={open}><summary onClick={event => { event.preventDefault(); setExpanded(!open); }}><span className={`dsp-dot ${item.status}`} />{item.kind === 'reasoning' ? '思考过程' : item.title || '工具调用'}{item.status === 'error' ? ' · 失败' : ''}</summary>{item.input && <pre>{item.input}</pre>}{item.kind === 'reasoning' ? <div className="dsp-markdown"><Markdown>{item.text}</Markdown></div> : item.text && <pre>{item.text}</pre>}</details>;
  }
  return <div className={`dsp-item dsp-item-${item.kind}`}>
    {item.kind === 'user' ? <><small>{item.status === 'error' ? '发送失败' : '收到任务消息'} · {new Date(item.time).toLocaleTimeString('zh-CN')}</small>{item.text}</> : item.kind === 'assistant' ? <Markdown>{item.text}</Markdown> : item.text}
  </div>;
}

function Timeline({ task }: { task: Conversation }): React.ReactElement {
  const entries: { time: number; key: string; item?: TranscriptItem; turn?: Turn }[] = [
    ...task.items.map(item => ({ time: item.time, key: item.id, item })),
    ...task.turns.map(turn => ({ time: turn.endedAt ?? Infinity, key: `turn:${turn.id}`, turn })),
  ];
  entries.sort((a, b) => a.time - b.time);
  return <>{entries.map(entry => {
    if (entry.item) {
      return <Item key={entry.key} item={entry.item} />;
    }
    const turn = entry.turn!;
    return <div className="dsp-turn" key={entry.key}>{turn.status === 'running' ? '正在处理' : turn.status === 'completed' ? '已完成' : turn.status === 'interrupted' ? '已停止' : '执行失败'}{turn.endedAt && `，用时 ${Math.max(1, Math.round((turn.endedAt - turn.startedAt) / 1000))} 秒`}{turn.inputTokens !== undefined && ` · 输入 ${turn.inputTokens.toLocaleString()} token`}{turn.outputTokens !== undefined && ` · 输出 ${turn.outputTokens.toLocaleString()} token`}</div>;
  })}</>;
}

function backendLabel(backend: string): string {
  return backend === 'codex' ? 'Codex' : 'Claude Code';
}

function statusLabel(status: string): string {
  return ({ starting: '正在连接', running: '执行中', idle: '已完成', interrupted: '已停止', error: '执行失败', closed: '可恢复' } as Record<string, string>)[status] || status;
}
