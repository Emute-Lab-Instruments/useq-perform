# SolidJS + XState + Effect Migration

This document outlines the migration strategy for transforming the legacy vanilla JS + jQuery codebase to a modern SolidJS + XState + Effect stack.

## Current Status: ✅ Scaffold Setup Complete

The initial scaffold has been successfully set up alongside the existing codebase. You can now see a working test component in the top-right corner when you visit http://localhost:5000.

## Architecture Overview

### New Stack Components
- **SolidJS**: Fine-grained reactive UI framework (no virtual DOM)
- **XState**: State machines and actor model for predictable state management
- **Effect**: Composable, type-safe side effects with retries and error handling

### Project Structure
```
src-solid/
  ui/             # Pure SolidJS components
  machines/       # XState state machines (domain logic)  
  effects/        # Effect modules (IO, schedulers, HTTP, storage)
  islands/        # Solid mount points in legacy pages
  lib/            # Framework-agnostic utilities
  routes/         # (future) SolidJS router components
```

## Migration Strategy: Strangler Fig Pattern

### Phase A: Island Approach (Current Phase)
1. ✅ Embed Solid islands in existing pages
2. ✅ Create test machine + effect to verify setup
3. 🔄 **Next**: Identify first high-value widget to migrate (e.g., settings panel, toolbar button)

### Phase B: Component Replacement (Future)
1. Replace DOM manipulation hotspots (modals, tabs, forms)
2. Convert jQuery event handlers to Solid event handlers
3. Move API calls from $.ajax to Effect modules

### Phase C: Complete Migration (Future)
1. Adopt @solidjs/router for client-side routing
2. Remove jQuery dependencies
3. Consolidate all state in XState machines

## What's Been Set Up

### 1. Build System
- **Vite + TypeScript**: Modern build tooling for the Solid components
- **Dual builds**: Legacy (esbuild) + Modern (vite) running in parallel
- **Scripts**: 
  - `npm run build:solid` - Build SolidJS components
  - `npm run build:legacy` - Build existing vanilla JS
  - `npm run watch:solid` - Watch mode for development

### 2. Test Island
- **Location**: Top-right corner of the main page
- **Features**: 
  - Counter with XState machine
  - Async effect with retry logic
  - Demonstrates Solid signals + XState + Effect integration

### 3. Utility Functions
- `useActorSignal`: Bridges XState actors to Solid signals
- `effectResource`: Converts Effect computations to Solid resources

## Key Files Created

### Configuration
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript configuration for Solid code

### Test Components
- `src-solid/machines/test.machine.ts` - Simple XState machine
- `src-solid/effects/test.ts` - Effect module with async operations
- `src-solid/ui/TestComponent.tsx` - Solid component demonstrating integration
- `src-solid/islands/test-island.tsx` - Island mount point

### Integration
- `public/index.html` - Updated to include test island
- `package.json` - Updated scripts for dual builds

## Migration Priority Order

Based on codebase analysis, components should be migrated in the following order to minimize dependencies and maximize impact:

### 🔥 Phase 1: Core Utility Components (Week 1-2)
- [ ] **Settings Panel** (`src/ui/settings/`) - Self-contained with minimal dependencies  
- [ ] **Theme Manager** (`src/editors/themes/themeManager.mjs`) - Independent styling system
- [ ] **Tab System** (`src/ui/tabs.mjs`) - Reusable UI pattern used by many components
- [ ] **Panel Utils** (`src/ui/utils.mjs`) - Shared utilities for panel management

### 🎯 Phase 2: UI Interaction Components (Week 3-4)  
- [ ] **Toolbar** (`src/ui/toolbar.mjs`) - High jQuery usage (22 occurrences), central to UX
- [ ] **Help System** (`src/ui/help/`) - Multi-file module with user guides and references
- [ ] **Picker Menu** (`src/ui/pickerMenu.mjs`) - Interactive dropdown/selection component
- [ ] **Snippets Panel** (`src/ui/snippets.mjs`) - Code snippet management UI

### 🚀 Phase 3: Editor Integration (Week 5-6)
- [ ] **Editor Configuration** (`src/editors/editorConfig.mjs`) - CodeMirror integration layer
- [ ] **Editor Extensions** (`src/editors/extensions/`) - Custom editor behaviors 
- [ ] **Gamepad Control** (`src/editors/gamepadControl.mjs`) - Alternative input handling
- [ ] **Keymaps** (`src/editors/keymaps.mjs`) - Keyboard shortcut management

### 🔧 Phase 4: I/O & External Systems (Week 7-8)
- [ ] **Serial Communications** (`src/io/serialComms.mjs`) - Hardware interface (3 jQuery calls)
- [ ] **Console Output** (`src/ui/console.mjs`) - Logging and debug interface
- [ ] **Visualization Components** (`src/ui/serialVis/`, `src/ui/internalVis/`) - Data display
- [ ] **Camera Interface** (`src/ui/camera.mjs`) - Media handling

### 🏗️ Phase 5: System Architecture (Week 9-10)
- [ ] **Main UI Orchestrator** (`src/ui/ui.mjs`) - Root component initialization (6 jQuery calls)
- [ ] **URL Parameters** (`src/urlParams.mjs`) - Route/state management 
- [ ] **Persistent Settings** (`src/utils/persistentUserSettings.mjs`) - Data persistence
- [ ] **Main Entry Point** (`src/main.mjs`) - Application bootstrap

## Migration Strategy Rationale

### Why This Order?

1. **Settings First**: Self-contained, well-defined state, good learning component
2. **Utilities Early**: Shared components reduce duplication in later migrations  
3. **UI Before Logic**: Visual components are easier to test and validate
4. **Editor Integration**: Complex but well-encapsulated in dedicated modules
5. **I/O Systems**: External dependencies require careful state management
6. **Core Last**: Main orchestration components depend on migrated components

### Dependency Analysis

**Low jQuery Usage** (Good migration candidates):
- Settings: Self-contained forms and tabs
- Themes: Mostly computational with minimal DOM manipulation
- Utils: Helper functions with limited UI interaction

**High jQuery Usage** (Complex but high-impact):
- Toolbar: 22 jQuery calls - central UI component
- UI Orchestrator: 6 calls - but depends on other components
- Serial Comms: 3 calls - hardware integration complexity

**Architectural Bottlenecks**:
- `src/main.mjs`: Entry point that initializes everything
- `src/ui/ui.mjs`: UI orchestrator that manages all panels
- `src/editors/main.mjs`: Editor system foundation

## Next Steps

### Immediate (Week 1-2)
1. **Start with Settings Panel**: Self-contained component with clear state boundaries
2. **Create Settings Machine**: Model settings validation and persistence in XState
3. **Migrate Tab System**: Reusable pattern for other components

### Medium Term (Week 3-4)  
1. **Toolbar Migration**: High-impact component with many interactions
2. **Help System**: Multi-component module good for testing patterns
3. **Establish Migration Patterns**: Document successful approaches

### Long Term (Month 2+)
1. **Editor Integration**: Complex but well-encapsulated system
2. **I/O System Migration**: Hardware interfaces with state management
3. **Architecture Consolidation**: Main orchestration and bootstrap code

## Development Workflow

### Running in Development
```bash
npm run dev    # Starts both legacy and solid watchers + dev server
```

### Building for Production
```bash
npm run build  # Builds both legacy and solid components
```

### Working with Islands
1. Create new island in `src-solid/islands/`
2. Add mount point to HTML with unique ID
3. Build with `npm run build:solid`
4. Refresh browser to see changes

## Testing the Setup

Visit http://localhost:5000 and you should see:
1. Original application working normally
2. Test island in top-right corner with:
   - Working counter (+/-/Reset buttons)
   - Async "Test Effect" button that shows delayed message
   - State display showing XState machine state

## Best Practices

### Code Organization
- Keep machines framework-agnostic (no Solid imports)
- Effects should be pure functions that return Effect values
- UI components should be thin wrappers around machines

### Migration Safety
- Always test that legacy functionality still works
- Use feature flags for gradual rollout
- Keep rollback path available for each migration

### Performance
- Solid's fine-grained reactivity means minimal re-renders
- XState machines are deterministic and testable
- Effect provides built-in error handling and retries

## Troubleshooting

### Build Issues
- Ensure TypeScript types are correct
- Check vite.config.ts for entry points
- Verify import paths are correct

### Runtime Issues  
- Check browser console for mount point errors
- Verify island IDs match between HTML and TypeScript
- Ensure all dependencies are installed

---

The migration foundation is now in place. The next step is to choose your first real component to migrate and start replacing jQuery interactions with Solid + XState + Effect patterns.