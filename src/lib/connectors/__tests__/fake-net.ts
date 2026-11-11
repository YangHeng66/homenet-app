/* 测试用的假 HTTP 层：把录好的响应喂给真实的 createHttp，这样错误映射也一起被测到。 */
import { createHttp, type Http, type HttpResponse, type TransportRequest } from '../http';

export interface FakeCall extends TransportRequest {
  /** 已解码的路径 */
  path: string;
  query: URLSearchParams;
  /** 请求体按 JSON 解析的结果，不是 JSON 时为 undefined */
  json: any;
  /** 请求体按表单解析的结果 */
  form: URLSearchParams;
}

const REPLY = Symbol('reply');
type Reply = HttpResponse & { [REPLY]: true };

export const reply = (status: number, data: unknown = '', headers: Record<string, string> = {}): Reply =>
  ({ [REPLY]: true, status, data, headers });

export function fakeNet(handler: (call: FakeCall) => unknown): { http: Http; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const http = createHttp({
    transport: async req => {
      const u = new URL(req.url);
      let json: any;
      try { json = req.body === undefined ? undefined : JSON.parse(req.body); } catch { json = undefined; }
      const call: FakeCall = { ...req, path: decodeURIComponent(u.pathname), query: u.searchParams, json, form: new URLSearchParams(req.body ?? '') };
      calls.push(call);
      const out = await handler(call);
      if (out && typeof out === 'object' && REPLY in out) return out as Reply;
      return { status: 200, headers: {}, data: out };
    },
  });
  return { http, calls };
}
