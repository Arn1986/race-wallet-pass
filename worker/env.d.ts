export {};

declare global {
  interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: any }>;
    run(): Promise<{ success: boolean; meta: any }>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<{ results: T[] }[]>;
    exec(query: string): Promise<{ count: number; duration: number }>;
  }

  interface R2Bucket {
    head(key: string): Promise<any>;
    get(key: string): Promise<any>;
    put(key: string, value: any, options?: any): Promise<any>;
    delete(key: string | string[]): Promise<void>;
    list(options?: any): Promise<{ objects: any[]; truncated: boolean }>;
  }

  interface Queue<T = any> {
    send(message: T, options?: any): Promise<void>;
    sendBatch(messages: Iterable<{ body: T }>): Promise<void>;
  }

  interface Fetcher {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }

  interface Message<T = any> {
    attempts?: number;
    id: string;
    timestamp: Date;
    body: T;
    ack(): void;
    retry(): void;
  }

  interface MessageBatch<T = any> {
    queue: string;
    messages: readonly Message<T>[];
    ackAll(): void;
    retryAll(): void;
  }
}
