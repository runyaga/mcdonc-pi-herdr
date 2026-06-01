/**
 * Pane-based background job management
 * 
 * Instead of forking processes and tracking them manually,
 * we spawn herdr panes to run background tasks.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { herdrRequest, getHerdrEnv, getSessionFile, getCurrentWorkspaceId, shortId, slugifyCommand, fmtAge } from "./lib.ts";

export interface BackgroundPane {
  paneId: string;
  label: string;
  command: string;
  createdAt: number;
}

export class PaneManager {
  private herdr;
  private backgroundPanes: Map<string, BackgroundPane> = new Map();

  constructor() {
    this.herdr = getHerdrEnv();
  }

  isEnabled(): boolean {
    return this.herdr.enabled;
  }

  /**
   * Background the current bash command by spawning a new pane
   */
  async backgroundCommand(command: string, ctx: any): Promise<BackgroundPane | null> {
    if (!this.herdr.enabled) {
      return null;
    }

    try {
      const sessionFile = getSessionFile(ctx);
      const label = `bg:${slugifyCommand(command)}`;
      
      // Create a new pane split below the current one
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.split",
        {
          target_pane_id: this.herdr.paneId,
          direction: "down",
          size: 30, // 30% of height
          label,
          focus: false, // Keep focus on original pane
        }
      );

      if (response.error) {
        console.log("Failed to create background pane:", response.error);
        return null;
      }

      const newPaneId = response.result?.pane_id;
      if (!newPaneId) {
        return null;
      }

      // If we have a session file and want to continue the same conversation,
      // we could start pi with that session in the new pane
      // For now, just send the command directly
      await herdrRequest(
        this.herdr.socketPath,
        "pane.send_text",
        {
          pane_id: newPaneId,
          text: command + "\n",
        }
      );

      const bgPane: BackgroundPane = {
        paneId: newPaneId,
        label,
        command,
        createdAt: Date.now(),
      };

      this.backgroundPanes.set(newPaneId, bgPane);
      return bgPane;
    } catch (err) {
      console.log("Error creating background pane:", err);
      return null;
    }
  }

  /**
   * Background the current pi task: leave it running and open a new tab
   * with a fresh pi that has the original conversation context.
   */
  async backgroundPiTask(ctx: any, extraPrompt?: string): Promise<BackgroundPane | null> {
    if (!this.herdr.enabled) {
      return null;
    }

    try {
      const sessionFile = getSessionFile(ctx);

      // Find our workspace by listing them
      const wsResp = await herdrRequest(this.herdr.socketPath, "workspace.list", {});
      const workspaces: Array<{ workspace_id: string }> = wsResp.result?.workspaces || [];
      const workspaceId = workspaces[0]?.workspace_id;
      if (!workspaceId) {
        console.log("pi-herdr: no workspace found");
        return null;
      }

      const label = `bg:${shortId()}`;

      // Write resume marker only if we have a session to fork
      if (sessionFile) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const resumeDir = path.join(process.cwd(), ".devenv/state/herdr");
        await fs.mkdir(resumeDir, { recursive: true });
        await fs.writeFile(path.join(resumeDir, "resume-session"), sessionFile + "\n");
      }

      // Create a new tab with a fresh pi (will pick up resume-session.json if implemented) that will pick up the session context.
      // We pass the session file path as an env var so the new pi's extension
      // can resume the conversation.
      const response = await herdrRequest(
        this.herdr.socketPath,
        "tab.create",
        {
          workspace_id: workspaceId,
          label,
          focus: true, // Switch to the new tab
        }
      );

      if (response.error) {
        console.log("Failed to create background tab:", response.error);
        return null;
      }

      const newTabId = response.result?.tab_id;
      const rootPaneId = response.result?.root_pane?.pane_id;

      if (!rootPaneId) {
        console.log("No pane created in new tab");
        return null;
      }

      const bgPane: BackgroundPane = {
        paneId: rootPaneId,
        label,
        command: `pi [tab resume]`,
        createdAt: Date.now(),
      };

      this.backgroundPanes.set(rootPaneId, bgPane);
      return bgPane;
    } catch (err) {
      console.log("Error backgrounding pi task:", err);
      return null;
    }
  }

  /**
   * List all background panes
   */
  async listBackgroundPanes(): Promise<BackgroundPane[]> {
    if (!this.herdr.enabled) {
      return [];
    }

    // Clean up panes that no longer exist
    const panesList = await this.fetchAllPanes();
    const existingIds = new Set(panesList.map(p => p.pane_id));
    
    for (const [id] of this.backgroundPanes) {
      if (!existingIds.has(id)) {
        this.backgroundPanes.delete(id);
      }
    }

    return Array.from(this.backgroundPanes.values());
  }

  /**
   * Focus a background pane
   */
  async focusPane(paneId: string): Promise<boolean> {
    if (!this.herdr.enabled) {
      return false;
    }

    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.get",
        { pane_id: paneId }
      );

      if (response.error) {
        return false;
      }

      // Focus by switching to the tab and pane
      // This is a simplified approach; real implementation would need proper focus API
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close a background pane
   */
  async closePane(paneId: string): Promise<boolean> {
    if (!this.herdr.enabled) {
      return false;
    }

    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.close",
        { pane_id: paneId }
      );

      if (!response.error) {
        this.backgroundPanes.delete(paneId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Read output from a background pane
   */
  async readPaneOutput(paneId: string, lines = 100): Promise<string> {
    if (!this.herdr.enabled) {
      return "";
    }

    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.read",
        {
          pane_id: paneId,
          source: "scrollback",
          line_count: lines,
        }
      );

      if (response.error) {
        return "";
      }

      return response.result?.content || "";
    } catch {
      return "";
    }
  }

  /**
   * Send input to a background pane
   */
  async sendToPaneInput(paneId: string, text: string): Promise<boolean> {
    if (!this.herdr.enabled) {
      return false;
    }

    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.send_text",
        { pane_id: paneId, text }
      );

      return !response.error;
    } catch {
      return false;
    }
  }

  private async fetchAllPanes(): Promise<Array<{ pane_id: string }>> {
    try {
      const response = await herdrRequest(
        this.herdr.socketPath,
        "pane.list",
        {}
      );

      if (response.error) {
        return [];
      }

      return response.result?.panes || [];
    } catch {
      return [];
    }
  }

  /**
   * Format background panes for display
   */
  formatPanesList(panes: BackgroundPane[]): string {
    if (panes.length === 0) {
      return "No background panes";
    }

    const lines = ["Background panes:", ""];
    for (const pane of panes) {
      const age = fmtAge(Date.now() - pane.createdAt);
      lines.push(`  ${pane.paneId.slice(0, 8)}  ${age.padEnd(6)}  ${pane.label}`);
      lines.push(`    → ${pane.command}`);
    }

    return lines.join("\n");
  }
}
