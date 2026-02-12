import { render, fireEvent, cleanup, screen } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CameraPanel } from "./CameraPanel";

describe("CameraPanel", () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;
  let mockTrackStop: ReturnType<typeof vi.fn>;
  let mockStream: MediaStream;

  beforeEach(() => {
    mockTrackStop = vi.fn();
    mockStream = {
      getTracks: () => [{ stop: mockTrackStop }, { stop: mockTrackStop }],
    } as unknown as MediaStream;

    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);

    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with camera-panel container", () => {
    const { container } = render(() => <CameraPanel />);
    expect(container.querySelector(".camera-panel")).toBeTruthy();
  });

  it("renders Open Camera button when stream is not active", () => {
    render(() => <CameraPanel />);
    expect(screen.getByText("Open Camera")).toBeTruthy();
  });

  it("does not render Close Camera button initially", () => {
    render(() => <CameraPanel />);
    expect(screen.queryByText("Close Camera")).toBeNull();
  });

  it("hides video element when no stream is active", () => {
    const { container } = render(() => <CameraPanel />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.display).toBe("none");
  });

  it("shows Close Camera button after opening camera", async () => {
    render(() => <CameraPanel />);
    const openBtn = screen.getByText("Open Camera");
    await fireEvent.click(openBtn);

    expect(screen.queryByText("Open Camera")).toBeNull();
    expect(screen.getByText("Close Camera")).toBeTruthy();
  });

  it("calls getUserMedia with correct constraints", async () => {
    render(() => <CameraPanel width={640} height={480} />);
    const openBtn = screen.getByText("Open Camera");
    await fireEvent.click(openBtn);

    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: 640, height: 480 },
    });
  });

  it("uses default dimensions (1200x800) when no props provided", async () => {
    render(() => <CameraPanel />);
    const openBtn = screen.getByText("Open Camera");
    await fireEvent.click(openBtn);

    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: 1200, height: 800 },
    });
  });

  it("shows video element when stream is active", async () => {
    const { container } = render(() => <CameraPanel />);
    const openBtn = screen.getByText("Open Camera");
    await fireEvent.click(openBtn);

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.display).toBe("block");
  });

  it("stops tracks and hides video when closing camera", async () => {
    render(() => <CameraPanel />);

    // Open the camera
    await fireEvent.click(screen.getByText("Open Camera"));
    expect(screen.getByText("Close Camera")).toBeTruthy();

    // Close the camera
    await fireEvent.click(screen.getByText("Close Camera"));

    expect(mockTrackStop).toHaveBeenCalledTimes(2); // 2 tracks
    expect(screen.getByText("Open Camera")).toBeTruthy();
    expect(screen.queryByText("Close Camera")).toBeNull();
  });

  it("displays error when getUserMedia is not supported", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { container } = render(() => <CameraPanel />);
    await fireEvent.click(screen.getByText("Open Camera"));

    const errorEl = container.querySelector(".camera-error");
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent).toContain("not supported");
  });

  it("displays error when getUserMedia rejects", async () => {
    mockGetUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError")
    );

    const { container } = render(() => <CameraPanel />);
    await fireEvent.click(screen.getByText("Open Camera"));

    const errorEl = container.querySelector(".camera-error");
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent).toContain("NotAllowedError");
    expect(errorEl?.textContent).toContain("Permission denied");
  });

  it("clears error on successful camera open after failure", async () => {
    // First attempt fails
    mockGetUserMedia.mockRejectedValueOnce(new Error("fail"));

    const { container } = render(() => <CameraPanel />);
    await fireEvent.click(screen.getByText("Open Camera"));
    expect(container.querySelector(".camera-error")).toBeTruthy();

    // Second attempt succeeds
    mockGetUserMedia.mockResolvedValueOnce(mockStream);
    await fireEvent.click(screen.getByText("Open Camera"));
    expect(container.querySelector(".camera-error")).toBeNull();
  });

  it("cleans up stream on unmount", async () => {
    const { unmount } = render(() => <CameraPanel />);
    await fireEvent.click(screen.getByText("Open Camera"));

    unmount();

    expect(mockTrackStop).toHaveBeenCalledTimes(2);
  });

  it("exposes open/close on window.__cameraPanel", () => {
    render(() => <CameraPanel />);
    expect((window as any).__cameraPanel).toBeDefined();
    expect(typeof (window as any).__cameraPanel.open).toBe("function");
    expect(typeof (window as any).__cameraPanel.close).toBe("function");
  });
});
