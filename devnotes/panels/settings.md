# Settings Panel Styling Reference

This document provides a complete reference for the HTML structure, CSS IDs, classes, and other properties of the settings panel and its related elements.

---

## Main Settings Panel

### Panel Container

- **Element**: `<div>`
- **ID**: `pannel-settings`
- **Classes**: `panel-aux`
- **Description**: The main container for the settings panel.

---

## Tabs

### Tabs Container

- **Element**: `<div>`
- **Classes**: `panel-tabs`
- **Description**: Contains the individual tabs for the settings panel.

### Individual Tabs

- **Element**: `<div>`
- **Classes**: `panel-tab`
- **Active Tab Class**: `active`
- **IDs**:
  - `panel-settings-tab-general`: General settings tab.
  - `panel-settings-tab-keybindings`: Key bindings settings tab.
  - `panel-settings-tab-themes`: Themes settings tab.
- **Description**: Represents each tab in the settings panel.

---

## Tab Content

### General Tab Content

- **Element**: `<div>`
- **ID**: `panel-settings-general`
- **Classes**: `panel-tab-content`
- **Active Tab Class**: `active`
- **Description**: Container for the general settings content.

### Key Bindings Tab Content

- **Element**: `<div>`
- **ID**: `panel-settings-keybindings`
- **Classes**: `panel-tab-content`
- **Description**: Container for the key bindings settings content.

### Themes Tab Content

- **Element**: `<div>`
- **ID**: `panel-settings-theme`
- **Classes**: `panel-tab-content`
- **Description**: Container for the themes settings content.

---

## General Settings

### Container

- **Element**: `<div>`
- **Classes**: `settings-container`
- **Description**: The main container for all general settings sections.

### Sections

- **Element**: `<div>`
- **Classes**: `settings-section`, `panel-section`
- **Description**: Represents a section within the general settings.
- **Sub-elements**:
  - **Section Title**:
    - **Element**: `<h3>`
    - **Classes**: `settings-section-title`, `panel-section-title`
    - **Description**: Title of the section.

### Form Rows

- **Element**: `<div>`
- **Classes**: `settings-row`, `panel-row`
- **Description**: Represents a row in the settings form.
- **Sub-elements**:
  - **Label**:
    - **Element**: `<label>`
    - **Classes**: `settings-label`, `panel-label`
    - **Description**: Label for the form control.
  - **Control**:
    - **Element**: `<div>`
    - **Classes**: `settings-control`, `panel-control`
    - **Description**: Container for the form control.

### Controls

- **Text Input**:
  - **Element**: `<input>`
  - **Classes**: `settings-text-input`, `panel-text-input`
  - **Attributes**: `type="text"`
  - **Description**: Used for text input fields.
- **Number Input**:
  - **Element**: `<input>`
  - **Classes**: `settings-number-input`, `panel-number-input`
  - **Attributes**: `type="number"`
  - **Description**: Used for numeric input fields.
- **Select Dropdown**:
  - **Element**: `<select>`
  - **Classes**: `settings-select`, `panel-select`
  - **Description**: Dropdown for selecting options.
- **Checkbox**:
  - **Element**: `<input>`
  - **Classes**: `settings-checkbox`, `panel-checkbox`
  - **Attributes**: `type="checkbox"`
  - **Description**: Checkbox for boolean settings.

### Reset Button

- **Container**:
  - **Element**: `<div>`
  - **Classes**: `settings-reset-container`
  - **Description**: Container for the reset button.
- **Button**:
  - **Element**: `<button>`
  - **Classes**: `settings-reset-button`, `panel-button`
  - **Description**: Button to reset all settings.

---

## Themes Settings

### Themes Container

- **Element**: `<div>`
- **Classes**: `themes-container`
- **Description**: Container for the themes grid.

### Theme Previews

- **Element**: `<div>`
- **Classes**: `theme-preview`, `panel-section`
- **Description**: Container for each theme preview.
- **Sub-elements**:
  - **Theme Name**:
    - **Element**: `<div>`
    - **Classes**: `theme-name`
    - **Description**: Displays the name of the theme.

---

## Toolbar

### Toolbar Container

- **Element**: `<div>`
- **ID**: `panel-toolbar`
- **Description**: The main container for the toolbar.

### Toolbar Rows

- **Element**: `<div>`
- **Classes**: `toolbar-row`
- **Description**: Represents a row in the toolbar.

### Toolbar Buttons

- **Element**: `<a>`
- **Classes**: `toolbar-button`
- **IDs**:
  - `button-connect`: Button for connecting.
  - `button-graph`: Button for graph visualization.
  - `button-decrease-font`: Button to decrease font size.
  - `button-increase-font`: Button to increase font size.
  - `button-help`: Button for help.
  - `button-settings`: Button to open settings.
- **Description**: Represents a button in the toolbar.
- **Sub-elements**:
  - **Icon**:
    - **Element**: `<i>`
    - **Attributes**: `data-lucide="<icon-name>"`
    - **Description**: Icon for the button.

---

## Panels

### Main Editor Panel

- **Element**: `<div>`
- **ID**: `panel-main-editor`
- **Description**: Container for the main editor.

### Console Panel

- **Element**: `<div>`
- **ID**: `panel-console`
- **Description**: Container for the console.

### Visualization Panel

- **Element**: `<div>`
- **ID**: `panel-vis`
- **Description**: Container for visualization canvases.
- **Sub-elements**:
  - **Canvas**:
    - **Element**: `<canvas>`
    - **IDs**:
      - `serialcanvas`: Serial canvas.
      - `canvas-plot`: Plot canvas.
      - `canvas-timeline`: Timeline canvas.
    - **Attributes**: `width="1000"`, `height="800"`

---

## Help Panel

### Help Panel Container

- **Element**: `<div>`
- **ID**: `panel-help`
- **Classes**: `panel-aux`
- **Description**: The main container for the help panel.

### Tabs

- **Element**: `<div>`
- **Classes**: `panel-tabs`
- **Description**: Contains the individual tabs for the help panel.

### Individual Tabs

- **Element**: `<div>`
- **Classes**: `panel-tab`
- **Active Tab Class**: `active`
- **IDs**:
  - `panel-help-tab-guide`: User guide tab.
  - `panel-help-tab-reference`: ModuLisp reference tab.
- **Description**: Represents each tab in the help panel.

### Tab Content

- **Element**: `<div>`
- **Classes**: `panel-tab-content`
- **Active Tab Class**: `active`
- **IDs**:
  - `panel-help-guide`: User guide content.
  - `panel-help-reference`: ModuLisp reference content.
- **Description**: Container for the help tab content.

---
