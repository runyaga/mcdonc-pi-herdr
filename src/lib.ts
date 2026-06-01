/**
 * Shared utilities for herdr-pi integration
 */
import { createConnection } from "node:net";

export interface HerdrEnv {
  socketPath: string;
  paneId: string;
  enabled: boolean;
}

export function getHerdrEnv(): HerdrEnv {
  const socketPath = process.env.HERDR_SOCKET_PATH || "";
  const paneId = process.env.HERDR_PANE_ID || "";
  // HERDR_ENV is set by the pi-herdr wrapper script.
  // HERDR_SOCKET_PATH is set by herdr.
  const enabled = process.env.HERDR_ENV === "1" && !!socketPath;
  
  return { socketPath, paneId, enabled };
}

export interface HerdrRequest {
  id: string;
  method: string;
  params: Record<string, any>;
}

export interface HerdrResponse {
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Send a request to herdr API and wait for response
 */
export async function herdrRequest(
  socketPath: string,
  method: string,
  params: Record<string, any>,
  timeoutMs = 5000
): Promise<HerdrResponse> {
  return new Promise((resolve, reject) => {
    const id = `pi-herdr:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const request: HerdrRequest = { id, method, params };
    
    let done = false;
    let responseData = "";
    
    const finish = (result?: HerdrResponse, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("No response received"));
      }
    };
    
    const socket = createConnection(socketPath);
    
    socket.on("error", (err) => finish(undefined, err));
    
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    
    socket.on("data", (chunk) => {
      responseData += chunk.toString();
      
      // Check if we have a complete JSON line
      const newlineIndex = responseData.indexOf("\n");
      if (newlineIndex !== -1) {
        const line = responseData.slice(0, newlineIndex);
        try {
          const response = JSON.parse(line) as HerdrResponse;
          if (response.id === id) {
            finish(response);
          }
        } catch (err) {
          finish(undefined, new Error(`Invalid JSON response: ${err}`));
        }
      }
    });
    
    socket.on("end", () => {
      // Defer to allow pending 'data' events to fire first.
      // TCP may deliver FIN before the accompanying data chunk
      // on the same segment, causing 'end' to race ahead.
      setImmediate(() => {
        if (done) return;

        // Last chance: try to parse any buffered data
        if (responseData.length > 0) {
          try {
            const lines = responseData.trim().split("\n").filter(l => l.length > 0);
            for (const line of lines) {
              const response = JSON.parse(line) as HerdrResponse;
              if (response.id === id) {
                finish(response);
                return;
              }
            }
          } catch {
            // Fall through to error below
          }
        }

        finish(undefined, new Error("Connection closed before response"));
      });
    });
    
    const timer = setTimeout(() => {
      finish(undefined, new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Generate a short random ID
 */
export function shortId(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Format age in human-readable form
 */
export function fmtAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Slugify a command for display
 */
export function slugifyCommand(cmd: string, maxLen = 20): string {
  const cleaned = cmd
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + "…";
}

/**
 * Extract pi session file from context
 */
export function getSessionFile(ctx: any): string | undefined {
  try {
    const file = ctx?.sessionManager?.getSessionFile?.();
    return typeof file === "string" && file.startsWith("/") ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract pi session ID from context
 */
export function getSessionId(ctx: any): string | undefined {
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract current workspace ID from herdr
 */
export async function getCurrentWorkspaceId(socketPath: string, paneId: string): Promise<string | undefined> {
  try {
    const response = await herdrRequest(socketPath, "pane.get", { pane_id: paneId });
    if (response.error) return undefined;
    return response.result?.workspace_id;
  } catch {
    return undefined;
  }
}

/**
 * Extract current tab ID from herdr
 */
export async function getCurrentTabId(socketPath: string, paneId: string): Promise<string | undefined> {
  try {
    const response = await herdrRequest(socketPath, "pane.get", { pane_id: paneId });
    if (response.error) return undefined;
    return response.result?.tab_id;
  } catch {
    return undefined;
  }
}

/**
 * Check if a string is a valid pane ID
 */
export function isValidPaneId(id: string): boolean {
  return /^p_\d+$/.test(id);
}

/**
 * Check if a string is a valid tab ID
 */
export function isValidTabId(id: string): boolean {
  return /^t_\d+$/.test(id);
}
