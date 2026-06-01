{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
let
  # Get herdr from the upstream flake
  herdr = inputs.herdr.packages.${pkgs.system}.default;
in
{

  dotenv.enable = true;
  
  languages = {
    javascript = {
      enable = true;
      npm = {
        enable = true;
        install = {
          enable = true;
        };
      };
    };
  };

  # Use pre-built herdr from upstream flake and testing tools
  packages = [ herdr pkgs.tmux ];

  # Isolate herdr to project-local state directory
  # All these will be set in enterShell since they need $PWD expansion
  
  # Add bin/ to PATH so herdr can find herdr-shell-with-pi
  env.PATH = "\${PWD}/bin:\${PATH}";

  # Symlink the extension so changes are immediately visible
  enterShell = ''
    # Create isolated herdr state directory
    mkdir -p .devenv/state/herdr
    
    # Set environment variables to isolate herdr from global config
    export HERDR_CONFIG_PATH="$PWD/.herdr.toml"
    export HERDR_SOCKET_PATH="$PWD/.devenv/state/herdr/herdr.sock"
    export XDG_CONFIG_HOME="$PWD/.devenv/state"
    
    if [ ! -e .pi/extensions/herdr ]; then
      echo "Symlinking herdr extension: .pi/extensions/herdr -> src/"
      mkdir -p .pi/extensions
      ln -s ../../src .pi/extensions/herdr
      echo "Extension linked. Edit src/ and use /reload in pi to reload changes."
    fi
    
    echo ""
    echo "📝 Project-local herdr config: .herdr.toml"
    echo "   New panes will automatically run: pi-herdr"
    echo "   (pi --no-extensions --extension src/index.ts)"
    echo ""
    echo "💡 Start herdr in this shell and create panes - they will run pi with only the herdr extension!"
  '';

  scripts.pi-herdr.exec = ''
    # Use the locally installed pi from node_modules
    # Find the project root by looking for package.json
    PROJECT_ROOT=$(pwd)
    while [ ! -f "$PROJECT_ROOT/package.json" ] && [ "$PROJECT_ROOT" != "/" ]; do
      PROJECT_ROOT=$(dirname "$PROJECT_ROOT")
    done
    
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
      echo "Error: Could not find project root (package.json)" >&2
      exit 1
    fi

    # Check for resume marker (written by /bg command)
    RESUME_FILE="$PROJECT_ROOT/.devenv/state/herdr/resume-session"
    FORK_FLAG=""
    if [ -f "$RESUME_FILE" ]; then
      SESSION_PATH=$(cat "$RESUME_FILE" 2>/dev/null)
      if [ -n "$SESSION_PATH" ]; then
        FORK_FLAG="--fork $SESSION_PATH"
        rm -f "$RESUME_FILE"  # Remove marker so only one pane picks it up
      fi
    fi

    # Pass LLM provider settings from environment if set
    PROVIDER_FLAGS=""
    if [ -n "''${PI_HERDR_PROVIDER:-}" ]; then
      PROVIDER_FLAGS="$PROVIDER_FLAGS --provider $PI_HERDR_PROVIDER"
    fi
    if [ -n "''${PI_HERDR_MODEL:-}" ]; then
      PROVIDER_FLAGS="$PROVIDER_FLAGS --model $PI_HERDR_MODEL"
    fi
    if [ -n "''${PI_HERDR_API_KEY:-}" ]; then
      PROVIDER_FLAGS="$PROVIDER_FLAGS --api-key $PI_HERDR_API_KEY"
    fi

    exec env HERDR_ENV=1 "$PROJECT_ROOT/node_modules/.bin/pi" --no-extensions --extension "$PROJECT_ROOT/src/index.ts" $FORK_FLAG $PROVIDER_FLAGS "$@"
  '';

  scripts.demo.exec = ''
    echo "Run pi under herdr and use these commands to try the extension:"
    echo "  /bg          - Background current task"
    echo "  /tab         - Fork conversation to new tab"
    echo "  /tab:back    - Return to previous fork"
    echo "  /tab:root    - Return to root conversation"
    echo "  /panes       - List background panes"
    echo "  /tabs        - List forked conversations"
  '';

}
