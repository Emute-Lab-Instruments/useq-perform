# Changelog

All notable changes to this project will be documented in this file.

## [v1.1.0](https://github.com/Emute-Lab-Instruments/useq-perform/releases/tag/v1.1.0) (e506828)

Released on: 2025-02-24

### Fixes

- Fix comments by stripping them out before sending to uSEQ (f947bfb)
  - NOTE: temporary fix until next uSEQ firmware.

### Improvements

- Console:
  - Increase maximum lines and make it scrollable (9c850ab)
  - Add '>' prefix to console messages (2493c5a)
- Visualisation of signals:
  - Improve serial visualization scaling and markers (13a40bb)
  - Add dotted zero line and quarter-mark indicators
- Better help panel styling and add toggle for Mac bindings (5492a94)
- Add wiggle animation to "connect" button for "uSEQ not connected" message (c988c06)

### Code Quality & Refactoring

- Major codebase refactoring (63bc30d):
  - Add comments
  - Centralize exports near top of modules
  - Better panel state management
- Split main.mjs into smaller files for better maintainability (a51e213)
- Fix comment handling inside expressions (f947bfb)
- Simplify "new firmware release" message (2f7c5bb)
- Remove debug print statements (4ed3c22, 9c850ab)

### Documentation

- Add CODEBASE_TOUR.md with project structure overview and extension guidelines (35058ec)
- Enhance code documentation in CircularBuffer.mjs with comments and error handling (320fff6)

### Other

- Add .local to .gitignore for local-only resources (ee2c9fe)

## [v1.0.0](https://github.com/Emute-Lab-Instruments/useq-perform/releases/tag/v1.0.0)

Released on: 2025-02-24

### New features:

1. Cycle through themes
2. Font size adjustment
3. Line numbers

### Improvements:

1. Better graphics for serial streams
2. Undo function fixed
4. It's more difficult to create orphaned brackets
5. Better looking buttons
6. Better serial connection management