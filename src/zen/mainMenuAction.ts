import { closeMainMenu } from "../lib/mainMenu/store";
import { buildZenHash } from "./routing";

export function selectMainMenuAction(
  id: string,
  browser: { location: { hash: string; reload(): void } } | undefined =
    typeof window === "undefined" ? undefined : window,
): void {
  if (id === "practiceZone" && browser) {
    browser.location.hash = buildZenHash(null);
    browser.location.reload();
  }
  closeMainMenu();
}
