/**
 * Tab-based conversation forking
 * 
 * Instead of manipulating pi's session tree, we create new herdr tabs
 * for parallel conversations.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  herdrRequest,
  getHerdrEnv,
  getCurrentWorkspaceId,
  getCurrentTabId,
  getSessionFile,
  shortId,
} from "./lib.ts";

export interface ForkInfo {
  tabId: string;
  label: string;
  createdAt: number;
  originalTabId: string;
}

export class TabManager {
  private herdr;
  private forks: Map<string, ForkInfo> = new Map();
  private forkStack: string[] = []; // Track fork hierarchy for /bb navigation

  constructor() {
    this.herdr = getHerdrEnv();
  }

  isEnabled(): boolean {
    return this.herdr.enabled;
  }

  /**
   * Fork the current conversation into a new tab
   */
  async forkConversation(ctx: any, label?: string, message?: string): Promise<ForkInfo | null> {
    if (!this.herdr.enabled) {
      return null;
    }

    try {
      const workspaceId = await getCurrentWorkspaceId(this.herdr.socketPath, this.herdr.paneId);
      const currentTabId = await getCurrentTabId(this.herdr.socketPath, this.herdr.paneId);
      
      if (!workspaceId || !currentTabId) {
        console.error("Could not determine workspace or tab");
        return null;
      }

      const forkLabel = label || `fork:${shortId()}`;

      // Create a new tab for the forked conversation
      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.create",
        {
          workspace_id: workspaceId,
          label: forkLabel,
          focus: true, // Switch to the new tab
        }
      );

      if (response.error || !response.result?.tab_id) {
        console.error("Failed to create fork tab:", response.error);
        return null;
      }

      const newTabId = response.result.tab_id;

      const fork: ForkInfo = {
        tabId: newTabId,
        label: forkLabel,
        createdAt: Date.now(),
        originalTabId: currentTabId,
      };

      this.forks.set(newTabId, fork);
      this.forkStack.push(currentTabId);

      // If a message is provided, send it to the new tab
      // We'd need to get the pane ID in the new tab first
      if (message) {
        // TODO: Get the main pane in the new tab and send the message
        // This requires querying for panes in the new tab
      }

      return fork;
    } catch (err) {
      console.error("Error forking conversation:", err);
      return null;
    }
  }

  /**
   * Return to the previous forked conversation (/bb equivalent)
   */
  async returnToPrevious(): Promise<boolean> {
    if (!this.herdr.enabled || this.forkStack.length === 0) {
      return false;
    }

    try {
      const previousTabId = this.forkStack.pop();
      if (!previousTabId) {
        return false;
      }

      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.focus",
        { tab_id: previousTabId }
      );

      return !response.error;
    } catch {
      return false;
    }
  }

  /**
   * Return to the root conversation (/bbb equivalent)
   */
  async returnToRoot(): Promise<boolean> {
    if (!this.herdr.enabled || this.forkStack.length === 0) {
      return false;
    }

    try {
      const rootTabId = this.forkStack[0];
      if (!rootTabId) {
        return false;
      }

      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.focus",
        { tab_id: rootTabId }
      );

      if (!response.error) {
        // Clear the fork stack since we're back at root
        this.forkStack.length = 0;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List all forked tabs
   */
  async listForks(): Promise<ForkInfo[]> {
    if (!this.herdr.enabled) {
      return [];
    }

    // Clean up forks that no longer exist
    const allTabs = await this.fetchAllTabs();
    const existingIds = new Set(allTabs.map(t => t.tab_id));
    
    for (const [id] of this.forks) {
      if (!existingIds.has(id)) {
        this.forks.delete(id);
      }
    }

    return Array.from(this.forks.values());
  }

  /**
   * Get the current fork depth
   */
  getForkDepth(): number {
    return this.forkStack.length;
  }

  /**
   * Close a forked tab
   */
  async closeFork(tabId: string): Promise<boolean> {
    if (!this.herdr.enabled) {
      return false;
    }

    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.close",
        { tab_id: tabId }
      );

      if (!response.error) {
        this.forks.delete(tabId);
        // Remove from fork stack if present
        const index = this.forkStack.indexOf(tabId);
        if (index !== -1) {
          this.forkStack.splice(index, 1);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async fetchAllTabs(): Promise<Array<{ tab_id: string }>> {
    try {
      const workspaceId = await getCurrentWorkspaceId(this.herdr.socketPath, this.herdr.paneId);
      if (!workspaceId) {
        return [];
      }

      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.list",
        { workspace_id: workspaceId }
      );

      if (response.error) {
        return [];
      }

      return response.result?.tabs || [];
    } catch {
      return [];
    }
  }

  /**
   * Format forks list for display
   */
  formatForksList(forks: ForkInfo[]): string {
    if (forks.length === 0) {
      return "No forked conversations";
    }

    const lines = ["Forked conversations:", ""];
    for (const fork of forks) {
      const age = this.fmtAge(Date.now() - fork.createdAt);
      lines.push(`  ${fork.tabId}  ${age.padEnd(6)}  ${fork.label}`);
    }

    if (this.forkStack.length > 0) {
      lines.push("");
      lines.push(`Fork depth: ${this.forkStack.length}`);
    }

    return lines.join("\n");
  }

  private fmtAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }
}
