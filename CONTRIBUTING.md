# Contributing

Thanks for your interest in contributing to OpenClaw Node for VS Code!

## Development Setup

1. Fork and clone the repository
2. `npm install`
3. `npm run watch` for development
4. Press `F5` in VS Code to launch the Extension Development Host

## Building

```bash
npm run build          # Production build
npm run watch          # Watch mode
npx vsce package --no-dependencies  # Package VSIX
```

## Code Style

- TypeScript strict mode
- ESBuild for bundling
- Keep dependencies minimal (VS Code API + tweetnacl for crypto)

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Test in both VS Code and Cursor
4. Submit a PR with a clear description

## Reporting Issues

Please include:
- VS Code / Cursor version
- Extension version
- OpenClaw Gateway version
- Steps to reproduce
- Error messages from Output panel (`OpenClaw Node`)
