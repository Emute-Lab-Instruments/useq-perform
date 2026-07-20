import type { SynthesisService } from "../../audio/synthesisService";
import type { EngineStateSnapshot } from "../../contracts/synthesisChannels";

export function createEngineIndicatorResumeHandler(
  getSnapshot: () => EngineStateSnapshot,
  getService: () => SynthesisService | null,
): () => void {
  return () => {
    const service = getService();
    if (service === null) return;
    if (getSnapshot().state === "error") {
      void service.recoverFromError().then((recovered) => {
        if (recovered) void service.resumeOnUserActivation();
      });
      return;
    }
    void service.resumeOnUserActivation();
  };
}
