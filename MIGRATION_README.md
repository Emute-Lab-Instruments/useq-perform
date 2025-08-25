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

## Next Steps

### Immediate (Week 1-2)
1. **Identify Migration Target**: Choose first real component to migrate
   - Suggested: Settings panel or toolbar interactions
   - Look for components with complex state or frequent DOM updates

2. **Create Real Machine**: Replace test machine with actual domain logic
   - Example: Settings validation, network connection status, file operations

3. **Replace jQuery Gradually**: Start with one event handler at a time
   - Convert `$(selector).on('click', handler)` to `onClick={handler}`

### Medium Term (Week 3-4)  
1. **Form Handling**: Migrate form interactions to Solid + XState
2. **API Integration**: Move Ajax calls to Effect modules with proper retry/error handling
3. **State Management**: Consolidate scattered state into XState machines

### Long Term (Month 2+)
1. **Router Migration**: When ready, introduce @solidjs/router
2. **jQuery Removal**: Eliminate jQuery dependency entirely
3. **SSR (Optional)**: Consider Solid Start for server-side rendering if needed

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