import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostAPI } from '@dsh-plugin/dsh-loader';
import { API, object, text } from './model.js';
import type { Conversations } from './conversations.js';

/** 所有读取和控制都使用宿主浏览器鉴权，并要求同源请求。 */
export function registerHttp(loader: HostAPI, conversations: Conversations): () => void {
  const connection = loader.services.get('connection') as { authorizeIndex(request: IncomingMessage, response: ServerResponse): boolean };
  return loader.web.register(API, (request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (!connection.authorizeIndex(request, response)) {
        return;
      }
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== request.headers.host)) {
        reply(response, 403, { error: '拒绝跨站访问子智能体。' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const parts = url.pathname.slice(API.length).split('/').filter(Boolean);
      const parent = url.searchParams.get('parent');
      if (!parent || parent.length > 512) {
        reply(response, 400, { error: '缺少有效的父会话 ID。' });
        return;
      }
      if (request.method === 'GET' && parts.length === 0) {
        reply(response, 200, { tasks: await conversations.files.list(parent) });
      } else if (request.method === 'GET' && parts.length === 1) {
        const record = await conversations.files.get(parent, parts[0]);
        if (url.searchParams.get('revision') === String(record.revision)) {
          reply(response, 204);
        } else {
          reply(response, 200, record);
        }
      } else if (request.method === 'POST' && parts.length === 2 && ['send', 'interrupt', 'release'].includes(parts[1])) {
        const body = await readBody(request);
        if (parts[1] === 'send') {
          const message = text(body.message);
          const requestId = text(body.requestId);
          if (!message.trim() || message.length > 100_000 || !/^[a-f0-9-]{36}$/.test(requestId)) {
            reply(response, 400, { error: '消息必须为 1 至 100000 个字符，并携带有效请求 ID。' });
            return;
          }
          await conversations.send(parent, parts[0], message, requestId);
        } else if (parts[1] === 'interrupt') {
          await conversations.interrupt(parent, parts[0]);
        } else {
          await conversations.release(parent, parts[0]);
        }
        reply(response, 200, { ok: true });
      } else {
        reply(response, 404, { error: '子智能体接口不存在。' });
      }
    })().catch(error => {
      if (!response.destroyed && !response.writableEnded) {
        reply(response, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new Error('请求必须使用 application/json。');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 512 * 1024) {
      throw new Error('消息请求超过大小限制。');
    }
    chunks.push(bytes);
  }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

function reply(response: ServerResponse, status: number, value?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}
