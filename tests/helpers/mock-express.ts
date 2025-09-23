import { EventEmitter } from 'events';

type Headers = Record<string, string | undefined>;

export class MockRequest extends EventEmitter {
  body: any;
  headers: Headers;
  method: string;
  url: string;
  user: any;
  ip: string;

  constructor(options: { body?: any; headers?: Headers; method?: string; url?: string; user?: any } = {}) {
    super();
    this.body = options.body ?? {};
    this.headers = {};
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      this.headers[key.toLowerCase()] = value;
    }
    this.method = options.method ?? 'POST';
    this.url = options.url ?? '/mcp';
    this.user = options.user;
    this.ip = '127.0.0.1';
  }

  get(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  header(name: string): string | undefined {
    return this.get(name);
  }
}

export class MockResponse {
  statusCode = 200;
  jsonPayload: any;
  headersSent = false;
  statusCalls: number[] = [];

  status(code: number): this {
    this.statusCode = code;
    this.statusCalls.push(code);
    return this;
  }

  json(payload: any): this {
    this.jsonPayload = payload;
    this.headersSent = true;
    return this;
  }
}

export const createMockRequest = (options?: ConstructorParameters<typeof MockRequest>[0]) =>
  new MockRequest(options);

export const createMockResponse = () => new MockResponse();
