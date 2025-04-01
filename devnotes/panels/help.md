# Help Panel Styling Reference

This document provides a complete reference for the HTML structure, CSS IDs, classes, and other properties of the help panel and its related elements.

---

## Help Panel

### Panel Container

- **Element**: `<div>`
- **ID**: `panel-help-docs`
- **Classes**: `panel-aux`
- **Description**: The main container for the help panel.

---

## Tabs

### Tabs Container

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

---

## Tab Content

### User Guide Tab Content

- **Element**: `<div>`
- **ID**: `panel-help-guide`
- **Classes**: `panel-tab-content`
- **Active Tab Class**: `active`
- **Description**: Container for the user guide content.

### ModuLisp Reference Tab Content

- **Element**: `<div>`
- **ID**: `panel-help-reference`
- **Classes**: `panel-tab-content`
- **Active Tab Class**: `active`
- **Description**: Container for the ModuLisp reference content.

---

## Documentation Panel

### Documentation Panel Container

- **Element**: `<div>`
- **ID**: `panel-documentation`
- **Classes**: `panel-aux`
- **Description**: The container for the documentation panel.

### Tags Container

- **Element**: `<div>`
- **Classes**: `doc-tags-container`
- **Description**: Container for the filter tags.

### Tags

- **Element**: `<div>`
- **Classes**: `doc-tag`
- **Selected Class**: `selected`
- **Description**: Represents a filter tag.

---

## Function List

### Function List Container

- **Element**: `<div>`
- **ID**: `doc-function-list`
- **Classes**: `doc-function-list`
- **Description**: Container for the list of documented functions.

### Function Item

- **Element**: `<div>`
- **Classes**: `doc-function-item`
- **Description**: Represents an individual function in the documentation.

### Function Header

- **Element**: `<div>`
- **Classes**: `doc-function-header`
- **Description**: Header for a function, containing its name and controls.

### Function Details

- **Element**: `<div>`
- **Classes**: `doc-function-details`
- **Description**: Container for the detailed information about a function.

---

## Examples

### Example Editor

- **Element**: `<div>`
- **Classes**: `doc-example-editor`
- **Description**: Container for the code editor displaying examples.

### Copy Button

- **Element**: `<button>`
- **Classes**: `doc-example-copy`
- **Description**: Button to copy the example code to the clipboard.

---

## Miscellaneous

### Expand/Collapse Indicator

- **Element**: `<span>`
- **Classes**: `doc-function-expand-indicator`
- **Description**: Indicator for expanding or collapsing function details.

### No Results Message

- **Element**: `<div>`
- **Classes**: `doc-no-results`
- **Description**: Message displayed when no functions match the selected filters.

---
