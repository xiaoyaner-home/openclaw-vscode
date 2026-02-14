# Changelog

## [0.2.0] - 2026-02-14

### Added
- **Activity Panel**: Bottom panel showing all AI operations with intent descriptions
- **Setup Wizard**: Guided 4-step configuration (Gateway, Security, Terminal, Agent)
- **Cursor Agent CLI integration**: `vscode.agent.run` with plan/agent/ask modes
- **Model dropdown**: Load available models from Cursor CLI in Settings
- Settings Panel with full configuration UI

### Fixed
- Shell escaping for prompts with special characters (parentheses, quotes)
- Auto-connect 3-second delay for Cursor's async settings loading

## [0.1.0] - 2026-02-14

### Added
- Initial release
- 37 IDE commands: file ops, editor, language intelligence, git, testing, debug
- WebSocket Gateway connection with auto-reconnect
- Ed25519 device identity for secure pairing
- Path traversal prevention and workspace sandboxing
- Terminal command whitelist
- Status bar indicator
