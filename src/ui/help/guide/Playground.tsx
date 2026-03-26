import { Component, Show, createSignal } from "solid-js";
import { CodeMirrorEditor } from "../CodeMirrorEditor";
import { MiniVis } from "../lessons/MiniVis";
import { LiveProbe } from "./LiveProbe";
import type { Playground } from "./guideTypes";

interface PlaygroundProps {
  playground: Playground;
}

export const PlaygroundBlock: Component<PlaygroundProps> = (props) => {
  const [editorCode, setEditorCode] = createSignal(props.playground.code);

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer?.setData("text/plain", props.playground.code);
  };

  const hasOutputs = () =>
    props.playground.outputs !== undefined &&
    props.playground.outputs.length > 0;

  const hasStaticSignals = () =>
    !hasOutputs() &&
    props.playground.signals !== undefined &&
    props.playground.signals.length > 0;

  return (
    <div class="guide-playground" draggable={true} onDragStart={handleDragStart}>
      <div class="guide-playground-header">
        <Show when={props.playground.annotation}>
          <div class="guide-playground-annotation">{props.playground.annotation}</div>
        </Show>
        <div class="guide-playground-drag-hint">⠿ drag to editor</div>
      </div>
      <div class="guide-playground-body">
        <div class="guide-playground-editor">
          <div class="userguide-cm-wrapper">
            <CodeMirrorEditor
              code={props.playground.code}
              lightweight={true}
              fontSize="13px"
              minHeight="24px"
              maxHeight="300px"
              onCodeChange={setEditorCode}
            />
          </div>
        </div>
        <Show when={hasOutputs()}>
          <div class="guide-playground-probe">
            <LiveProbe
              code={editorCode()}
              outputs={props.playground.outputs}
              fallbackSignals={props.playground.signals}
              bars={props.playground.bars}
              height={80}
            />
          </div>
        </Show>
        <Show when={hasStaticSignals()}>
          <div class="guide-playground-probe">
            <MiniVis signals={props.playground.signals!} height={80} bars={props.playground.bars} />
          </div>
        </Show>
      </div>
    </div>
  );
};
