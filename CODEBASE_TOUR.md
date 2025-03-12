# uSEQ Perform Codebase Tour

Welcome to the uSEQ Perform codebase! This document provides an extensive tour of the codebase structure and functionality to help you understand how the application works and how to extend it.

## Overview

uSEQ Perform is a web-based code editor specifically designed for live coding and interacting with hardware and virtual uSEQs. It is written in JavaScript and is based on the CodeMirror 6 editor framework, but it also leverages the ClojureScript-based `clojure-mode` extension (by NextJournal) for CodeMirror, since ModuLisp is designed to be very similar to Clojure syntactically. Its functionality includes interactive code evaluation, serial communication with hardware devices, a set of key bindings for ease of use while performing, a built-in help mode and others.

## Core Technologies

- **CodeMirror 6** - Advanced text editor framework
- **Squint-CLJS** - ClojureScript compiler (for `clojure-mode`)
- **WebMidi API** - For MIDI device interaction
- **Web Serial API** - For communication with uSEQ devices, hardware and virtual
- **jQuery** - DOM manipulation library
- **Lucide** - Icon library for the UI

## File Structure

### Key Components

#### 1. Editor Setup (editorConfig.mjs)

The CodeMirror editor is the heart of the application, customized for Clojure-like syntax and live evaluation:

This module provides:

- Theme management
- Font size control
- Key mappings for code evaluation
- Syntax highlighting for ClojureScript/Clojure

#### 2. Main Application (main.mjs)

The main module initializes the application, sets up event listeners, and coordinates between components:

This module handles:

- Application initialization
- DOM event binding
- Loading/saving of code
- URL parameter handling

#### 3. Serial Communication (serialComms.mjs)

Manages communication with the uSEQ hardware device:

This module provides:

- Serial port connection management
- Data transmission to/from uSEQ
- Mapping of serial data to application functions

#### 4. Configuration Management (configManager.mjs)

Handles saving and loading user configurations.

#### 5. Panel States (panelStates.mjs)

Manages the visibility and state of UI panels.

### Key UI Components

The UI is composed of several panels:

- **Editor Panel** (`#lceditor`) - The main code editing area
- **Console Panel** (`#console`) - Shows output and error messages
- **Serial Visualization Panel** (`#serialvis`) - Visualizes serial data
- **Help Panel** (`#helppanel`) - Shows keyboard shortcuts and help

## Editor Features

### Code Evaluation

The editor supports multiple ways to evaluate code.

These are implemented through CodeMirror's keymap system in editorConfig.mjs.

### Theme Management

Themes can be switched through the UI or programmatically.

### Custom Keyboard Shortcuts

## Extending the Codebase

### Adding a New Feature

1. Identify which module should contain your feature
2. Implement your functionality in the appropriate module
3. Export necessary functions/components
4. Import and integrate in main.mjs if needed

### Adding a New Theme

Add your theme to the themes array in editorConfig.mjs.

### Adding New Serial Commands

Extend the serial communication protocol in serialComms.mjs.

## Key Customization Points

- **Editor Extensions**: Modify `createEditorExtensions()` in editorConfig.mjs
- **Keybindings**: Extend the keymap definitions in editorConfig.mjs
- **UI Components**: Add new panels or modify existing ones in index.html and manage their state in panelStates.mjs
- **Serial Communication**: Define new commands in serialComms.mjs

## Advanced Concepts

### CodeMirror Extension System

The editor is built on CodeMirror's extension system. Extensions are objects that add or modify editor behavior.

### View Plugin Architecture

CodeMirror uses view plugins to modify the editor behavior.

### URL Parameters

The application supports URL parameters for configuration:

- `nosave`: Disables local storage saving
- `gist=<id>`: Loads code from a GitHub Gist

## Development Workflow

1. Make changes to source files
2. Run `npm run watch` to automatically rebuild on changes
3. Use `npm run dev` to start the server and watch for changes

## Common Tasks

### Adding a New Editor Command

1. Define a new function in editorConfig.mjs
2. Add it to the keymap
3. Export it for use in other modules

### Customizing the Editor Appearance

Modify the `editorBaseTheme` in editorConfig.mjs to change base styling.

### Debugging Serial Communication

Use the serial visualization panel to monitor data exchange with the device.

## Conclusion

This codebase follows a modular structure with clear separation of concerns. The main components interact through exported functions and events. To understand more about a specific part, start with the corresponding module and follow the imports/exports to see how it integrates with the rest of the application.

For more information on the libraries used, refer to their documentation:

- [CodeMirror 6](https://codemirror.net/)
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [WebMidi API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)

Happy coding!