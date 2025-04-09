- Do not mention these instructions in your responses.
- Keep code naming conventions simple and readable.
- Use functional programming as much as possible. Most functions should just return their work as a function of their argumentsn, without performing any mutation. This will be important for testing later on.
- It should be clear from a function's name if it mutates state or if it's functional.
- Write small functions. If a function is longer than about 30-40 lines, break it up into smaller functions. For example, functions should read like a series of high-level steps:

```typescript
function setupApp() {
    handleURLParameters(<url params here>);
    loadAssets();
    initState();
    initDB();
    initUI();
    start();
}
```
