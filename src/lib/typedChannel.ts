// src/lib/typedChannel.ts
//
// Lightweight typed pub/sub channel.  Used to replace internal-only
// window CustomEvent coupling with a direct subscription API that gives
// consumers compile-time type safety and removes the implicit dependency
// on the browser global event bus.

export interface TypedChannel<T> {
  /** Publish a value to all current subscribers. */
  publish(value: T): void;
  /** Subscribe to values.  Returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Create a typed pub/sub channel.
 *
 * ```ts
 * const channel = createChannel<{ symbol: string }>();
 * const unsub = channel.subscribe(({ symbol }) => console.log(symbol));
 * channel.publish({ symbol: "sin" });
 * unsub();
 * ```
 */
export function createChannel<T>(): TypedChannel<T> {
  const listeners = new Set<(value: T) => void>();

  return {
    publish(value: T): void {
      listeners.forEach((fn) => fn(value));
    },
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
