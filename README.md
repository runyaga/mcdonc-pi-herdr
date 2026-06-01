# mcdonc-pi-herdr

Herdr-native background jobs and conversation forking for [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

This extension deeply integrates pi with [herdr](https://github.com/ogulcancelik/herdr), using herdr's native primitives:
- **Herdr panes** for background job execution
- **Herdr tabs** for conversation forking

## Quick Start

```bash
# Clone the repository
git clone https://github.com/mcdonc/mcdonc-pi-herdr.git
cd mcdonc-pi-herdr

# Enter the development environment (requires Nix with devenv)
devenv shell

# Start herdr (configured via .herdr.toml to use pi-herdr for new panes)
herdr

# Create a new pane (ctrl+b, then v or minus)
# The new pane will automatically run pi-herdr with only this extension loaded
```

**Development workflow:**
- Source code is in `src/`
- `.pi/extensions/herdr/` is symlinked to `src/` (automatic on first shell enter)
- Project-local herdr config `.herdr.toml` sets `pi-herdr` as the default shell
- When you create new panes in herdr, they automatically run `pi-herdr` (only this extension loaded)
- Edit files in `src/` and use `/reload` inside pi to reload changes
- No need to reinstall or re-enter the shell

**How it works:**
- `devenv shell` sets `HERDR_CONFIG_PATH=.herdr.toml`
- `.herdr.toml` configures `terminal.default_shell = "pi-herdr"`
- `pi-herdr` is a devenv script that runs `pi --no-extensions --extension src/index.ts`
- This ensures only the herdr extension is loaded, no other extensions from `~/.pi/`

## Why herdr-native?

By integrating deeply with herdr's native features:
- ✅ Background tasks are **visible in the TUI** (you can see all running panes)
- ✅ Proper PTY isolation (herdr manages processes)
- ✅ Native process management (no PID tracking needed)
- ✅ Tabs provide clear conversation boundaries
- ✅ Works with herdr's workspace/pane/tab model

## Requirements

- [pi coding agent](https://github.com/earendil-works/pi-coding-agent)
- [herdr](https://github.com/ogulcancelik/herdr) (running pi inside herdr)
- Node.js (already required by pi)

## Features

### Background Jobs → Herdr Panes

Instead of forking processes in the background, spawn **herdr panes** to run tasks:

| Command | Description |
|---------|-------------|
| `/bg [extra]` | Background current task in a new pane |
| `/panes` | List all background panes |
| `/panes:tail <pane_id>` | Show output from a background pane |
| `/panes:close <pane_id>` | Close a background pane |
| `/panes:focus <pane_id>` | Switch focus to a background pane |

**Example workflow:**
1. Start a long-running task: `run ./build.sh`
2. While it's running, type `/bg` to move it to a new pane
3. Original pane is now free for new work
4. Use `/panes` to check on background tasks
5. Use `/panes:tail p_123` to see output

### Conversation Forking → Herdr Tabs

Instead of manipulating pi's session tree, create **herdr tabs** for parallel conversations:

| Command | Description |
|---------|-------------|
| `/tab [label] [message]` | Fork conversation into a new tab |
| `/tab:back` | Return to previous forked conversation |
| `/tab:root` | Return to root conversation |
| `/tabs` | List all forked conversations |

**Example workflow:**
1. Working on feature A
2. Think of something else: `/tab side-task`
3. New tab opens with fresh pi session
4. Work on side-task in the new tab
5. When done: `/tab:back` to return to feature A
6. Original conversation continues where you left off

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ctrl+b` | Context-aware: fork conversation or show pane selector |

## How It Works

### Pane-based Background Execution

When you `/bg` a task:

1. Extension calls `pane.split` via herdr's API
2. New pane is created below current pane (30% height)
3. Task is sent to the new pane
4. Original pane becomes idle and ready for new work
5. You can see the background pane in herdr's TUI

### Tab-based Conversation Forking

When you `/tab` (or `/b`):

1. Extension calls `tab.create` via herdr's API
2. New tab is created in the same workspace
3. New tab gets a fresh pi session
4. Extension tracks fork hierarchy for `/bb` navigation
5. Both tabs are visible in herdr's tab bar

## Architecture

```
mcdonc-pi-herdr/
├── index.ts          # Main extension entry point
├── lib.ts            # Herdr API client and utilities
├── pane-manager.ts   # Background pane management
├── tab-manager.ts    # Conversation fork management
├── package.json      # Package metadata
└── README.md         # This file
```

### Herdr API Integration

The extension communicates with herdr via its Unix socket API:

```typescript
// Example: Create a background pane
await herdrRequest(socketPath, "pane.split", {
  pane_id: currentPaneId,
  direction: "down",
  size: 30,
  label: "bg:build-script",
  focus: false
});

// Example: Fork into a new tab
await herdrRequest(socketPath, "tab.create", {
  workspace_id: currentWorkspaceId,
  label: "fork:side-task",
  focus: true
});
```

Herdr provides these environment variables:
- `HERDR_SOCKET_PATH` - Unix socket for API communication
- `HERDR_PANE_ID` - Current pane identifier
- `HERDR_ENV=1` - Indicates running inside herdr

## Design Philosophy

- **Leverage herdr**: Use herdr's native primitives instead of reimplementing them
- **Visual first**: Background work should be visible, not hidden
- **API-driven**: Communicate via herdr's JSON-RPC API
- **Simple state**: Let herdr manage persistence, we just track metadata

## Limitations

- **Requires herdr**: This extension only works when pi is running inside herdr
- **Tab creation**: Currently creates blank tabs; pi session continuity needs herdr agent resume support
- **Focus management**: Tab/pane focusing is simplified; full implementation needs herdr focus APIs

## Future Enhancements

### Session File Continuity
Current limitation: `/bg` creates a new pane but doesn't resume the pi session.

Solution needs herdr support for:
```rust
// In herdr's pane.split API
pub struct PaneSplitParams {
    // ... existing fields
    pub agent_resume: Option<AgentResumeParams>,
}

pub struct AgentResumeParams {
    pub agent: String,
    pub session_file: Option<String>,
    pub session_id: Option<String>,
}
```

### Interactive Selectors
Add TUI widgets for:
- Interactive pane picker (`ctrl+p`)
- Interactive tab picker (`ctrl+t`)
- Live output streaming (follow mode)

### Status Bar Integration
Show fork depth and background pane count in pi's status bar (needs pi status bar API).

## Development

```bash
cd ~/projects/mcdonc-pi-herdr

# With devenv:
devenv shell
runpi

# Or manually:
npm install
pi --extension ./index.ts
```

## Documentation

- [QUICKSTART.md](QUICKSTART.md) - Quick reference guide
- [EXAMPLES.md](EXAMPLES.md) - Detailed usage scenarios  
- [DESIGN.md](DESIGN.md) - Architecture details
- [INSTALL.md](INSTALL.md) - Installation instructions
- [TODO.md](TODO.md) - Roadmap and known issues
- [PROJECT.md](PROJECT.md) - Project overview

## Contributing

This is an experimental integration exploring herdr's API capabilities. Contributions welcome!

## License

MIT

## Related Projects

- [herdr](https://github.com/ogulcancelik/herdr) - Terminal workspace manager for AI coding agents
- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) - AI coding agent with deep editor integration
