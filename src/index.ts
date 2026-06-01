/**
 * mcdonc-pi-herdr — Herdr-native background jobs and conversation forking for Pi
 * 
 * This extension integrates pi deeply with herdr, using:
 * - Herdr panes for background job execution (instead of process backgrounding)
 * - Herdr tabs for conversation forking (instead of session tree manipulation)
 * 
 * Features:
 * - /bg [extra]         - Background current task in a new herdr pane
 * - /tab [message]      - Fork conversation into a new herdr tab
 * - /tab:back           - Return to previous fork
 * - /tab:root           - Return to root conversation
 * - /panes              - List background panes
 * - /panes:tail <id>    - Show output from a background pane
 * - /panes:close <id>   - Close a background pane
 * - /tabs               - List forked conversations
 * 
 * Keyboard shortcuts:
 * - ctrl+b              - Quick background or fork (context-aware)
 * - ctrl+p              - Pane selector
 * - ctrl+t              - Tab/fork selector
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PaneManager } from "./pane-manager.ts";
import { TabManager } from "./tab-manager.ts";
import { getHerdrEnv } from "./lib.ts";

export default function (pi: ExtensionAPI) {
  const herdr = getHerdrEnv();
  
  if (!herdr.enabled) {
    console.log("mcdonc-pi-herdr: Not running in herdr, extension disabled");
    return;
  }

  console.log(`mcdonc-pi-herdr: Enabled in pane ${herdr.paneId}`);

  const paneManager = new PaneManager();
  const tabManager = new TabManager();

  // ========================================================================
  // Background Job Commands
  // ========================================================================

  pi.registerCommand("/bg", {
    description: "Background current task (leave it running) and open a new pi tab with context",
    async handler(args, ctx) {
      const extraPrompt = args.trim();

      // DON'T abort the current task — let it keep running

      const pane = await paneManager.backgroundPiTask(ctx, extraPrompt || undefined);
      
      if (pane) {
        return `Backgrounded task in pane ${pane.paneId} (${pane.label})`;
      } else {
        return "Failed to create background pane";
      }
    },
  });

  pi.registerCommand("/panes", {
    description: "List background panes",
    async handler(_args, _ctx) {
      const panes = await paneManager.listBackgroundPanes();
      return paneManager.formatPanesList(panes);
    },
  });

  pi.registerCommand("/panes:tail", {
    description: "Show output from a background pane",
    async handler(args, _ctx) {
      const paneId = args.trim();
      if (!paneId) {
        return "Usage: /panes:tail <pane_id>";
      }

      const output = await paneManager.readPaneOutput(paneId, 50);
      if (!output) {
        return `No output from pane ${paneId}`;
      }

      return `Output from ${paneId}:\n\n${output}`;
    },
  });

  pi.registerCommand("/panes:close", {
    description: "Close a background pane",
    async handler(args, _ctx) {
      const paneId = args.trim();
      if (!paneId) {
        return "Usage: /panes:close <pane_id>";
      }

      const success = await paneManager.closePane(paneId);
      return success
        ? `Closed pane ${paneId}`
        : `Failed to close pane ${paneId}`;
    },
  });

  pi.registerCommand("/panes:focus", {
    description: "Focus a background pane",
    async handler(args, _ctx) {
      const paneId = args.trim();
      if (!paneId) {
        return "Usage: /panes:focus <pane_id>";
      }

      const success = await paneManager.focusPane(paneId);
      return success
        ? `Focused pane ${paneId}`
        : `Failed to focus pane ${paneId}`;
    },
  });

  // ========================================================================
  // Conversation Fork Commands
  // ========================================================================

  pi.registerCommand("/tab", {
    description: "Fork conversation into a new herdr tab",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/);
      const label = parts[0] || undefined;
      const message = parts.slice(1).join(" ") || undefined;

      // Abort current turn if running
      if (ctx.abort) {
        ctx.abort();
      }

      const fork = await tabManager.forkConversation(ctx, label, message);
      
      if (fork) {
        return `Forked conversation to tab ${fork.tabId} (${fork.label})`;
      } else {
        return "Failed to fork conversation";
      }
    },
  });

  pi.registerCommand("/tab:back", {
    description: "Return to previous forked conversation",
    async handler(_args, _ctx) {
      const success = await tabManager.returnToPrevious();
      return success
        ? "Returned to previous conversation"
        : "No previous fork to return to";
    },
  });

  pi.registerCommand("/tab:root", {
    description: "Return to root conversation",
    async handler(_args, _ctx) {
      const success = await tabManager.returnToRoot();
      return success
        ? "Returned to root conversation"
        : "Already at root or no forks exist";
    },
  });

  pi.registerCommand("/tabs", {
    description: "List forked conversations",
    async handler(_args, _ctx) {
      const forks = await tabManager.listForks();
      return tabManager.formatForksList(forks);
    },
  });

  // ========================================================================
  // Keyboard Shortcuts
  // ========================================================================

  // ctrl+b: Context-aware background/fork
  pi.registerShortcut("ctrl+b", {
    description: "Context-aware background or fork",
    handler: async (ctx) => {
      // If agent is running, fork the conversation
      // If a bash tool is running, background it
      // Otherwise, show pane selector

      // For now, show a quick menu
      // TODO: Implement actual context detection
      const panes = await paneManager.listBackgroundPanes();
      if (panes.length > 0) {
        // Show panes if any exist
        ctx.ui.notify("Use /panes command to list background panes", "info");
      } else {
        // Otherwise fork
        ctx.ui.notify("Use /tab command to fork conversation", "info");
      }
    },
  });

  // ========================================================================
  // Status Bar Integration
  // ========================================================================

  // Show fork depth in status bar
  // TODO: This requires pi's status bar API
  // pi.statusBar.addItem(() => {
  //   const depth = tabManager.getForkDepth();
  //   return depth > 0 ? `⑂ ${depth} fork(s)` : "";
  // });

  // ========================================================================
  // Lifecycle Hooks
  // ========================================================================

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    console.log("mcdonc-pi-herdr: Session started");
    
    // Refresh pane and fork lists on session start
    await paneManager.listBackgroundPanes();
    await tabManager.listForks();
  });

  pi.on("tool_start", (event) => {
    // Track bash tool executions for potential backgrounding
    if (event.tool === "bash") {
      // Store the command for potential backgrounding
      // This would be used by ctrl+b during execution
    }
  });

  console.log("mcdonc-pi-herdr: Commands registered");
  console.log("  /bg, /panes, /tab, /tab:back, /tab:root, /tabs");
}
