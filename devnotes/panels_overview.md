# Panels Overview

## Help Panel (panel-help-docs)

### Architecture
- Combined panel that contains two tabs: Help and Documentation
- Uses a tabbed interface for switching between content
- Positioned as a modal overlay in the center of the screen
- Supports both light and dark themes with appropriate styling adjustments

### Features

#### Help Tab
- Displays keyboard shortcuts and key bindings
- OS-aware display (shows Mac/Windows shortcuts appropriately)
- Toggle switch for Mac/Windows key binding display
- Organized list of keyboard shortcuts with:
  - Visual tip icons
  - Key binding display
  - Description of functionality
- Common shortcuts include:
  - Evaluate code (Ctrl/⌘-Enter)
  - Evaluate selected code (Alt/⌥-Enter)
  - Show documentation for function at cursor (Alt/⌥-F)

#### Documentation Tab
- Function documentation browser
- Tag-based filtering system
- Sticky tag container at the top
- One column view for functions in sidebar mode, three column view in expanded mode
- Function items include:
  - Function name
  - Documentation content (expand/collapse)
  - Expandable/collapsible sections
- Support for direct linking to specific functions
- Theme-aware styling
- Dev mode support for development purposes

### UI/UX Features
- Smooth transitions for opening/closing
- Responsive layout
- Scrollable content areas
- Theme-aware styling
- ESC key support for closing
- Position toggle support (can be centered or side-aligned)

## Settings Panel (panel-settings-themes)

### Architecture
- Combined panel with settings and themes tabs
- Uses a tabbed interface
- Persistent settings storage
- Theme-aware styling

### Features

#### Settings Tab
- UI Settings
  - Console line limit configuration (100-10000 lines)
  - Theme selection
  - Font size controls
- Editor Settings
  - Theme selection
  - Font size controls
- Persistent storage of user preferences
- Real-time updates when settings change

#### UI Components
- Section-based organization
- Form-based input controls
- Number inputs with validation
- Theme-aware styling for all controls
- Responsive layout

### Common Features Across Both Panels
- Tab-based navigation
- Theme-aware styling
- Smooth transitions
- ESC key support for closing
- Position toggle support
- Responsive design
- Accessibility considerations

## Technical Implementation Notes

### Panel Management
- Uses a shared panel management system
- Common visibility toggling mechanism
- Consistent styling and behavior across panels
- Theme-aware styling adjustments

### State Management
- Persistent storage for settings
- Theme state management
- Panel visibility state tracking

### Event Handling
- Direct DOM event listeners for reliability
- Event propagation control
- Keyboard shortcut support

### Styling
- CSS variables for theming
- Responsive design considerations
- Consistent styling patterns
- Theme-aware adjustments

### Performance Considerations
- Lazy loading of content
- Efficient DOM updates
- Smooth transitions
- Memory management for large datasets

## Areas for Improvement
1. Code organization could be more modular
2. State management could be more centralized
3. Theme handling could be more consistent
4. Panel positioning system could be more flexible
5. Documentation system could be more maintainable
6. Settings persistence could be more robust
7. Event handling could be more standardized
8. Accessibility features could be enhanced
