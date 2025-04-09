# uSEQ Perform Codebase Tour

## Overview

uSEQ Perform is a web-based, live-coding interface for the uSEQ hardware, a music/audio sequencing device. The application provides a code editor with Clojure-like syntax for programming the device in real-time, along with visualization tools for monitoring outputs and a comprehensive settings system.

## Tech Stack

### Frontend Technologies
- **JavaScript** (ES Modules)
- **HTML/CSS**
- **jQuery** - For DOM manipulation
- **CodeMirror 6** - Highly customizable code editor
- **Two.js** - 2D drawing API
- **Lucide** - Icon library
- **Marked** - Markdown parsing for documentation
- **Tabulator** - Interactive tables

### Build & Development Tools
- **esbuild** - Fast JavaScript bundler
- **serve** - Static file server with CORS support

### Key Libraries
- **@nextjournal/clojure-mode** - Clojure syntax highlighting for CodeMirror
- **WebMIDI** - MIDI protocol interface
- **color-convert** - Color manipulation for theming
- **squint-cljs** - ClojureScript-related functionality

## Codebase Structure

### Core Application Structure
- `src/main.mjs` - Main entry point that initializes the application
- `public/index.html` - HTML entry point, includes the bundled JavaScript and CSS
- `build.js` - Build script using esbuild

### Key Modules

#### User Interface (`src/ui/`)
- `ui.mjs` - Core UI initialization and management
- `toolbar.mjs` - Top toolbar controls
- `console.mjs` - Console output component
- `help/` - Documentation and reference panels
- `settings/` - User settings panels
- `serialVis/` - Serial data visualization components
- `snippets.mjs` - Code snippet management

#### Code Editors (`src/editors/`)
- `main.mjs` - Editor initialization
- `extensions.mjs` - CodeMirror extensions configuration
- `themes/` - Comprehensive theming system
  - `themeManager.mjs` - Theme application and management
  - `builtinThemes.mjs` - Collection of available editor themes
  - `builtinThemes/` - Individual theme definitions
- `extensions/` - Custom editor extensions
  - `sexprHighlight.mjs` - S-expression highlighting for Clojure code

#### I/O and Communication (`src/io/`)
- `serialComms.mjs` - Web Serial API interface to communicate with uSEQ hardware
- `console.mjs` - Console output management
- `midi.mjs` - MIDI communication
- `utils.mjs` - I/O utility functions

#### Utils and Helpers (`src/utils/`)
- `persistentUserSettings.mjs` - User settings management with localStorage
- `CircularBuffer.mjs` - Efficient circular buffer implementation for data
- `debug.mjs` - Debugging utilities
- `upgradeCheck.mjs` - Version checking and upgrade flow
- `upgradeFlow.mjs` - UI for version upgrades

### URL Parameter Handling (`src/urlParams.mjs`)
Handles URL parameters for session configuration and sharing.

## Key Features

### Live Coding Environment
The application provides a CodeMirror-based editor with Clojure-like syntax highlighting and auto-formatting. Users can write and execute code that controls the uSEQ hardware in real-time.

### Serial Communication
The application uses the Web Serial API to communicate with the uSEQ hardware. It handles serializing commands from the code editor and parsing the responses and data streams from the device.

### Data Visualization
A canvas-based visualization system displays data from the device in real-time, with smooth animations and custom rendering.

### Theme System
A sophisticated theming system allows users to choose between light and dark themes, affecting both the code editor and the visualization components. The system extends CodeMirror's theming capabilities.

### Persistent Settings
User preferences, including editor theme, font size, and code, are stored in `localStorage` for persistence across sessions.

### Documentation and Help
Comprehensive documentation is available within the application, including reference materials for the coding language used to control the device.

## UI Rendering Approach

The application uses a direct DOM manipulation approach rather than a framework-based architecture:

- **jQuery-based Components**: UI components are created via functions that generate and return DOM elements using jQuery
- **Manual State Management**: Component state is managed manually through closure variables and event handlers
- **Event-Driven Updates**: UI updates are triggered by events (user input, device responses, etc.)
- **Targeted DOM Updates**: Changes are applied directly to specific DOM elements rather than through virtual DOM diffing
- **Component Composition**: Larger UI sections are built by composing smaller component functions
- **CSS Classes for Styling**: Components apply CSS classes and inline styles for visual presentation

Most UI components follow a pattern where a factory function creates the element, sets up event handlers, and returns the DOM node for insertion into the document.

## Application Flow

1. The application initializes from `main.mjs`, which loads user settings and checks for Web Serial support.
2. The UI is initialized, setting up the code editor, console, and visualization components.
3. If a previously saved connection exists, the application attempts to reconnect to the uSEQ device.
4. Users can write and execute code in the editor, which is sent to the device via the Web Serial API.
5. Data from the device is visualized in real-time using the canvas-based visualization system.
6. User settings are automatically saved to localStorage for persistence.

## Development Workflow

The application uses a modern JavaScript development workflow:

1. ES modules for code organization
2. esbuild for bundling
3. Parallel watching and serving during development
4. CSS hot-reloading on localhost

## Developer Setup Guide

### Prerequisites
- Node.js (v14 or newer)
- npm (usually comes with Node.js)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/useq-perform.git
   cd useq-perform
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development Server
1. Start the development server:
   ```bash
   npm run dev
   ```
   This will:
   - Bundle the JavaScript with esbuild in watch mode
   - Start a local server on port 5000
   - Enable CSS hot-reloading

2. Open your browser to `http://localhost:5000`

### Building for Production
```bash
npm run build
```
This creates optimized files in the `dist/` directory.

### Extending the Application
- New UI components should be added to the appropriate subdirectory in `src/ui/`
- Editor extensions go in `src/editors/extensions/`
- New themes should follow the pattern in `src/editors/themes/builtinThemes/`

## Special Features

### S-Expression Tracking
The application includes specialized tracking for S-expressions in the code editor, which is crucial for Clojure-like languages.

### Themes with Variant Support
The theming system supports both light and dark variants, with automatic adjustments to visualization colors based on the selected theme.

### Responsive Panels
The UI includes panels that can be toggled and repositioned, providing a flexible interface for different workflows.

### URL Parameter Configuration
The application can be configured via URL parameters, allowing for easy sharing of specific setups.

## Conclusion

uSEQ Perform is a sophisticated web application that provides a live coding interface for the uSEQ hardware. It combines modern web technologies with a focus on user experience, providing a powerful tool for creative audio sequencing.
