import WebSocket from "ws";
import { randomUUID } from "crypto";
import { log, logError } from "./logger";
import { loadOrCreateDeviceIdentity, publicKeyRawBase64Url, signPayload } from "./device-identity";

const PROTOCOL_VERSION = 3;
const VERSION = "0.1.0";

export type InvokeHandler = (
  command: string,
  params: unknown
) => Promise<
  | { ok: true; payload?: unknown }
  | { ok: false; error: { code: string; message: string } }
>;

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface GatewayClientOptions {
  host: string;
  port: number;
  tls: boolean;
  token?: string;
  displayName: string;
  commands: string[];
  caps: string[];
  onInvoke: InvokeHandler;
  onStateChange: (state: ConnectionState) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface InvokeRequestPayload {
  id: string;
  nodeId: string;
  command: string;
  paramsJSON?: string | null;
  timeoutMs?: number | null;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private opts: GatewayClientOptions;
  private closed = false;
  private backoffMs = 1000;
  private nodeId: string;
  private _state: ConnectionState = "disconnected";
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
    this.nodeId = randomUUID();
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.opts.onStateChange(state);
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error("client stopped"));
    this.setState("disconnected");
  }

  private connect(): void {
    if (this.closed) return;

    const { host, port, tls } = this.opts;
    const scheme = tls ? "wss" : "ws";
    const url = `${scheme}://${host}:${port}`;

    this.setState("connecting");
    log(`Connecting to ${url}...`);

    const ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });
    this.ws = ws;

    ws.on("open", () => {
      log("WebSocket connected, waiting for challenge...");
      this.queueConnect();
    });

    ws.on("message", (data) => {
      try {
        this.handleMessage(data.toString());
      } catch (err) {
        logError(`Failed to parse frame: ${err}`);
      }
    });

    ws.on("close", (code, reason) => {
      log(`WebSocket closed (${code}): ${reason.toString()}`);
      this.ws = null;
      this.flushPending(new Error(`closed (${code})`));
      this.setState("disconnected");
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      logError(`WebSocket error: ${err.message}`);
    });
  }

  private queueConnect(): void {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    // Wait up to 750ms for a challenge event, then send connect anyway
    this.connectTimer = setTimeout(() => {
      this.sendConnect();
    }, 750);
  }

  private sendConnect(): void {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const token = this.opts.token?.trim() || undefined;
    const role = "node";
    const scopes: string[] = [];
    const signedAtMs = Date.now();
    const nonce = this.connectNonce ?? undefined;

    // Build device identity and signature
    const identity = loadOrCreateDeviceIdentity();
    const version = nonce ? "v2" : "v1";
    const payloadParts = [
      version,
      identity.deviceId,
      "node-host",
      "node",
      role,
      scopes.join(","),
      String(signedAtMs),
      token ?? "",
    ];
    if (version === "v2") {
      payloadParts.push(nonce ?? "");
    }
    const payload = payloadParts.join("|");
    const signature = signPayload(identity.privateKeyPem, payload);

    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: "node-host",
        displayName: this.opts.displayName,
        version: VERSION,
        platform: process.platform,
        mode: "node",
        instanceId: this.nodeId,
      },
      caps: this.opts.caps,
      commands: this.opts.commands,
      auth: token ? { token } : undefined,
      role,
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    };

    this.request("connect", params)
      .then((result) => {
        log(`Connected to Gateway: ${JSON.stringify(result)}`);
        this.backoffMs = 1000;
        this.setState("connected");
      })
      .catch((err) => {
        logError(`Connect rejected: ${err.message}`);
        this.ws?.close(1008, "connect failed");
      });
  }

  private handleMessage(raw: string): void {
    const parsed = JSON.parse(raw);

    // Event frame
    if (parsed.type === "event" || parsed.event) {
      const event = parsed.event as string;

      // Handle connect challenge
      if (event === "connect.challenge") {
        const nonce =
          parsed.payload && typeof parsed.payload.nonce === "string"
            ? parsed.payload.nonce
            : null;
        if (nonce) {
          this.connectNonce = nonce;
          this.sendConnect();
        }
        return;
      }

      // Handle node.invoke.request
      if (event === "node.invoke.request") {
        const payload = this.coerceInvokePayload(parsed.payload);
        if (payload) {
          void this.handleInvoke(payload);
        }
      }
      return;
    }

    // Response frame (to our requests)
    if (parsed.type === "res" || parsed.id) {
      const id = parsed.id as string;
      const p = this.pending.get(id);
      if (!p) return;

      // If it's an ack with status accepted, keep waiting
      if (parsed.payload?.status === "accepted") return;

      this.pending.delete(id);
      if (parsed.ok) {
        p.resolve(parsed.payload);
      } else {
        p.reject(
          new Error(parsed.error?.message ?? "unknown error")
        );
      }
    }
  }

  private coerceInvokePayload(payload: unknown): InvokeRequestPayload | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    if (!id || !nodeId || !command) return null;

    const paramsJSON =
      typeof obj.paramsJSON === "string"
        ? obj.paramsJSON
        : obj.params !== undefined
          ? JSON.stringify(obj.params)
          : null;

    return {
      id,
      nodeId,
      command,
      paramsJSON,
      timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : null,
    };
  }

  private async handleInvoke(frame: InvokeRequestPayload): Promise<void> {
    const { command } = frame;
    let params: unknown = {};
    if (frame.paramsJSON) {
      try {
        params = JSON.parse(frame.paramsJSON);
      } catch {
        params = {};
      }
    }

    log(`← invoke: ${command}`);

    try {
      const result = await this.opts.onInvoke(command, params);
      await this.sendInvokeResult(frame, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`invoke ${command} failed: ${message}`);
      await this.sendInvokeResult(frame, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message },
      });
    }
  }

  private async sendInvokeResult(
    frame: InvokeRequestPayload,
    result:
      | { ok: true; payload?: unknown }
      | { ok: false; error: { code: string; message: string } }
  ): Promise<void> {
    const params: Record<string, unknown> = {
      id: frame.id,
      nodeId: frame.nodeId,
      ok: result.ok,
    };

    if (result.ok && result.payload !== undefined) {
      params.payloadJSON = JSON.stringify(result.payload);
    } else if (!result.ok) {
      params.error = result.error;
    }

    try {
      await this.request("node.invoke.result", params);
    } catch (err) {
      logError(`Failed to send invoke result: ${err}`);
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("not connected"));
        return;
      }
      const id = randomUUID();
      const frame = { type: "req", id, method, params };
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.ws.send(JSON.stringify(frame));
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    log(`Reconnecting in ${delay / 1000}s...`);
    setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
