// src-solid/ui/TestComponent.tsx
import { createActor } from "xstate";
import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import { testMachine } from "../machines/test.machine";
import { useActorSignal } from "../lib/useActorSignal";
import { Effect } from "effect";
import { delayedMessage } from "../effects/test";

export function TestComponent() {
  const actor = createActor(testMachine);
  const { state, send } = useActorSignal(actor);
  const [isLoading, setIsLoading] = createSignal(false);
  
  actor.start();
  onCleanup(() => actor.stop());

  const handleAsyncMessage = async () => {
    setIsLoading(true);
    try {
      const result = await Effect.runPromise(delayedMessage("Hello from Effect!"));
      send({ type: "SET_MESSAGE", message: result });
    } catch (e) {
      send({ type: "SET_MESSAGE", message: `Error: ${e}` });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      padding: "20px",
      border: "2px solid #007acc",
      "border-radius": "8px",
      margin: "10px",
      "background-color": "#f0f9ff"
    }}>
      <h3>SolidJS + XState + Effect Test Component</h3>
      
      <div style={{ margin: "10px 0" }}>
        <strong>Count:</strong> {state().context.count}
      </div>
      
      <div style={{ "margin-bottom": "10px" }}>
        <button 
          onClick={() => send({ type: "INCREMENT" })}
          style={{ margin: "5px" }}
        >
          +
        </button>
        <button 
          onClick={() => send({ type: "DECREMENT" })}
          style={{ margin: "5px" }}
        >
          -
        </button>
        <button 
          onClick={() => send({ type: "RESET" })}
          style={{ margin: "5px" }}
        >
          Reset
        </button>
      </div>
      
      <div style={{ "margin-bottom": "10px" }}>
        <button 
          onClick={handleAsyncMessage}
          disabled={isLoading()}
          style={{ margin: "5px" }}
        >
          {isLoading() ? "Loading..." : "Test Effect"}
        </button>
      </div>
      
      <Show when={state().context.message}>
        <div style={{ 
          padding: "10px", 
          "background-color": "#e6f7ff", 
          "border-radius": "4px",
          "margin-top": "10px"
        }}>
          <strong>Message:</strong> {state().context.message}
        </div>
      </Show>
      
      <div style={{ 
        "font-size": "12px", 
        color: "#666", 
        "margin-top": "15px" 
      }}>
        State: {state().value} | Count: {state().context.count}
      </div>
    </div>
  );
}