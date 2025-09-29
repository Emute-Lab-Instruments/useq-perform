import { showPickerMenu, showNumberPickerMenu } from "./pickerMenu.mjs";

// Simple hierarchical wrapper: first show categories, then items.
// Returns a function that closes the active menu.
export function showHierarchicalGridPicker({ categories, title = 'Create', onSelect }) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return () => {};
  }

  let closeActive = null;
  let stack = [];

  function close() {
    if (closeActive) closeActive();
    closeActive = null;
    stack = [];
  }

  function openItems(cat) {
    // Number special-case – open number picker
    const items = Array.isArray(cat.items) ? cat.items : [];
    const mapped = items.map(it => ({ label: it.label, value: it.value, icon: it.icon }));
    if (closeActive) closeActive();
    stack.push('items');
    closeActive = showPickerMenu({
      items: mapped,
      title: `${title}: ${cat.label}`,
      layout: 'grid',
      initialIndex: 0,
      onSelect: (item) => {
        const original = items.find(x => x.label === item.label && x.value === item.value) || {};
        if (original.special === 'number') {
          // Open number picker then callback
          if (closeActive) closeActive();
          closeActive = showNumberPickerMenu({
            title: 'Pick a Number',
            initialValue: 0,
            onSelect: (num) => {
              close();
              onSelect?.({ label: String(num), value: num, insertText: String(num) });
            }
          });
          return;
        }
        close();
        onSelect?.(original.insertText ? original : { ...original, insertText: `(${String(original.value)} )` });
      }
    });
  }

  function openCategories() {
    const mapped = categories.map(c => ({ label: c.label, value: c.id }));
    if (closeActive) closeActive();
    stack.push('categories');
    closeActive = showPickerMenu({
      items: mapped,
      title,
      layout: 'grid',
      initialIndex: 0,
      onSelect: (item) => {
        const cat = categories.find(c => c.id === item.value) || categories[0];
        openItems(cat);
      }
    });
  }

  openCategories();
  return close;
}

