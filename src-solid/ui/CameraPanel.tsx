import { createSignal, onCleanup, Show } from "solid-js";

export type CameraPanelProps = {
  width?: number;
  height?: number;
};

export function CameraPanel(props: CameraPanelProps) {
  const width = () => props.width ?? 1200;
  const height = () => props.height ?? 800;

  const [stream, setStream] = createSignal<MediaStream | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let videoRef: HTMLVideoElement | undefined;

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("getUserMedia() not supported in this browser.");
      return false;
    }

    try {
      const vidStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: width(), height: height() },
      });
      setStream(vidStream);
      setError(null);

      if (videoRef) {
        videoRef.srcObject = vidStream;
        videoRef.onloadedmetadata = () => {
          videoRef!.play();
        };
      }
      return true;
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
      return false;
    }
  };

  const closeCamera = () => {
    const s = stream();
    if (s) {
      s.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef) {
      videoRef.srcObject = null;
    }
  };

  onCleanup(() => {
    closeCamera();
  });

  // Expose on window for legacy interop
  if (typeof window !== "undefined") {
    (window as any).__cameraPanel = {
      open: openCamera,
      close: closeCamera,
    };
  }

  return (
    <div class="camera-panel">
      <Show when={error()}>
        <div class="camera-error">{error()}</div>
      </Show>
      <video
        ref={videoRef}
        id="videopanel"
        style={{
          width: "100%",
          "max-width": `${width()}px`,
          display: stream() ? "block" : "none",
        }}
      />
      <Show when={!stream()}>
        <button class="camera-open-btn" onClick={openCamera}>
          Open Camera
        </button>
      </Show>
      <Show when={stream()}>
        <button class="camera-close-btn" onClick={closeCamera}>
          Close Camera
        </button>
      </Show>
    </div>
  );
}
