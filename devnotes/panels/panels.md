# Panels Styling Reference

This document provides a complete reference for the HTML structure, CSS IDs, classes, and other properties of the panels and their related elements.

---

## Base Panel

### Panel Container

- **Element**: `<div>`
- **Classes**: `panel-aux`
- **Description**: The base container for auxiliary panels.
- **Attributes**:
  - `position`: Fixed.
  - `height`: 70%.
  - `width`: 25%.
  - `z-index`: 400.
  - `transition`: `opacity 0.2s ease-in-out, visibility 0.2s ease-in-out`.

---

## Position Toggle Button

### Toggle Button

- **Element**: `<div>`
- **Classes**: `panel-position-toggle`
- **Description**: A button to toggle the position of the panel.
- **Attributes**:
  - `position`: Fixed.
  - `width`: 15px.
  - `height`: 32px.
  - `z-index`: 450.
- **Sub-elements**:
  - **Icon**:
    - **Element**: `<i>`
    - **Description**: Icon inside the toggle button.

---

## Centered Panel Mode

### Centered Panel

- **Element**: `<div>`
- **Classes**: `panel-aux centered`
- **Description**: A variation of the base panel that is centered on the screen.
- **Attributes**:
  - `width`: 80%.
  - `right`: 50%.
  - `transform`: `translate(50%, -50%)`.

---

## Panel Sections

### Section Container

- **Element**: `<div>`
- **Classes**: `panel-section`
- **Description**: A container for sections within a panel.
- **Attributes**:
  - `background-color`: `var(--panel-section-bg)`.
  - `border`: `1px solid var(--panel-border)`.
  - `border-radius`: `var(--item-border-radius)`.

### Section Title

- **Element**: `<h3>`
- **Classes**: `panel-section-title`
- **Description**: Title of a panel section.

---

## Panel Rows

### Row Container

- **Element**: `<div>`
- **Classes**: `panel-row`
- **Description**: A row layout for panel content.
- **Sub-elements**:
  - **Label**:
    - **Element**: `<label>`
    - **Classes**: `panel-label`
    - **Description**: Label for the row.
  - **Control**:
    - **Element**: `<div>`
    - **Classes**: `panel-control`
    - **Description**: Container for the row's control.

---

## Form Controls

### Text Input

- **Element**: `<input>`
- **Classes**: `panel-text-input`
- **Attributes**: `type="text"`
- **Description**: A text input field.

### Number Input

- **Element**: `<input>`
- **Classes**: `panel-number-input`
- **Attributes**: `type="number"`
- **Description**: A numeric input field.

### Select Dropdown

- **Element**: `<select>`
- **Classes**: `panel-select`
- **Description**: A dropdown for selecting options.

### Checkbox

- **Element**: `<input>`
- **Classes**: `panel-checkbox`
- **Attributes**: `type="checkbox"`
- **Description**: A checkbox for boolean settings.

---

## Panel Buttons

### Button

- **Element**: `<button>`
- **Classes**: `panel-button`
- **Description**: A button within a panel.
- **Attributes**:
  - `background-color`: `var(--panel-item-hover-bg)`.
  - `border`: `1px solid var(--panel-border)`.

---

## Tab Navigation

### Tabs Container

- **Element**: `<div>`
- **Classes**: `panel-tabs`
- **Description**: A container for panel tabs.

### Individual Tab

- **Element**: `<div>`
- **Classes**: `panel-tab`
- **Active Tab Class**: `active`
- **Description**: Represents an individual tab.

---

## Tab Content

### Tab Content Container

- **Element**: `<div>`
- **Classes**: `panel-tab-content`
- **Active Tab Class**: `active`
- **Description**: A container for the content of a tab.

---
