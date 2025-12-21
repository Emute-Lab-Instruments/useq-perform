// src-solid/ui/TransportToolbar.tsx
import { createActor } from "xstate";
import { onCleanup, onMount } from "solid-js";
import { transportMachine } from "../machines/transport.machine";
import { useActorSignal } from "../lib/useActorSignal";
import { Effect } from "effect";
import { play, pause, stop, rewind, clear } from "../effects/transport";

// We'll need a way to call createIcons since we're using data-lucide attributes
declare const lucide: any;

export function TransportToolbar() {
  const actor = createActor(transportMachine, {
    actions: {
      emitPlay: () => { Effect.runPromise(play()); },
      emitPause: () => { Effect.runPromise(pause()); },
      emitStop: () => { Effect.runPromise(stop()); },
      emitRewind: () => { Effect.runPromise(rewind()); },
      emitClear: () => { Effect.runPromise(clear()); },
    }
  });
  
  const { state, send } = useActorSignal(actor);
  
  actor.start();
  onCleanup(() => actor.stop());

  onMount(() => {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  });

  const isPlaying = () => state().value === "playing";
  const isPaused = () => state().value === "paused";
  const isStopped = () => state().value === "stopped";

  return (
    <div id="panel-top-toolbar">
      <div class="toolbar-row">
        <a 
          class={`toolbar-button ${isPlaying() ? 'primary disabled' : ''}`} 
          id="button-play" 
          title="Play"
          onClick={() => !isPlaying() && send({ type: "PLAY" })}
        >
          <i data-lucide="play"></i>
        </a>
        <a 
          class={`toolbar-button ${isPaused() ? 'primary disabled' : ''} ${isStopped() ? 'disabled' : ''}`} 
          id="button-pause" 
          title="Pause"
          onClick={() => !isPaused() && !isStopped() && send({ type: "PAUSE" })}
        >
          <i data-lucide="pause"></i>
        </a>
        <a 
          class={`toolbar-button ${isStopped() ? 'primary disabled' : ''}`} 
          id="button-stop" 
          title="Stop"
          onClick={() => !isStopped() && send({ type: "STOP" })}
        >
          <i data-lucide="square"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-rewind" 
          title="Rewind"
          onClick={() => send({ type: "REWIND" })}
        >
          <i data-lucide="rewind"></i>
        </a>
        <a 
          class="toolbar-button" 
          id="button-clear" 
          title="Clear"
          onClick={() => send({ type: "CLEAR" })}
        >
          <i data-lucide="x"></i>
        </a>
      </div>
    </div>
  );
}
