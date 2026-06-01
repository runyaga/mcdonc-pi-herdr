{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
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

  # Don't use herdr from flake - it requires Zig build that fails on macOS with Nix
  # Instead, we'll use pi directly from npm and the herdr extension from src/
  packages = [ pkgs.tmux ];

  # Add bin/ to PATH
  env.PATH = "\${PWD}/bin:\${PATH}";

  enterShell = ''
    # Create isolated state directory
    mkdir -p .devenv/state
    
    # Set environment variables
    export HERDR_ENV=1
    export XDG_CONFIG_HOME="$PWD/.devenv/state"
    
    if [ ! -e .pi/extensions/herdr ]; then
      echo "Symlinking herdr extension: .pi/extensions/herdr -> src/"
      mkdir -p .pi/extensions
      ln -s ../../src .pi/extensions/herdr
      echo "Extension linked. Edit src/ and use /reload in pi to reload changes."
    fi
    
    echo ""
    echo "📝 Using pi from npm with herdr extension from src/"
    echo "   Start pi with: pi --no-extensions --extension src/index.ts"
    echo ""
  '';

  scripts.pi-herdr.exec = ''
    PROJECT_ROOT=$(pwd)
    while [ ! -f "$PROJECT_ROOT/package.json" ] && [ "$PROJECT_ROOT" != "/" ]; do
      PROJECT_ROOT=$(dirname "$PROJECT_ROOT")
    done
    
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
      echo "Error: Could not find project root (package.json)" >&2
      exit 1
    fi

    RESUME_FILE="$PROJECT_ROOT/.devenv/state/herdr/resume-session"
    FORK_FLAG=""
    if [ -f "$RESUME_FILE" ]; then
      SESSION_PATH=$(cat "$RESUME_FILE" 2>/dev/null)
      if [ -n "$SESSION_PATH" ]; then
        FORK_FLAG="--fork $SESSION_PATH"
        rm -f "$RESUME_FILE"
      fi
    fi

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
