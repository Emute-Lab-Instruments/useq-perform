/** Framework-independent bootstrap recovery surface. */
export interface BootstrapRecoveryNotice {
  id: string;
  title: string;
  message: string;
  detail?: string;
}

const PREFIX = "bootstrap-recovery-";

export function clearBootstrapRecovery(id: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(`${PREFIX}${id}`)?.remove();
}

export function showBootstrapRecovery(notice: BootstrapRecoveryNotice): void {
  if (typeof document === "undefined" || !document.body) return;
  clearBootstrapRecovery(notice.id);

  const container = document.createElement("section");
  container.id = `${PREFIX}${notice.id}`;
  container.setAttribute("role", "alert");
  container.style.cssText = [
    "position:fixed",
    "left:1rem",
    "right:1rem",
    "bottom:1rem",
    "z-index:2147483647",
    "padding:0.9rem 1rem",
    "border:1px solid #d97706",
    "border-radius:0.5rem",
    "background:#1c1917",
    "color:#fafaf9",
    "font:14px/1.4 system-ui,sans-serif",
  ].join(";");

  const title = document.createElement("strong");
  title.textContent = notice.title;
  container.append(title);

  const message = document.createElement("div");
  message.textContent = notice.message;
  container.append(message);

  if (notice.detail) {
    const detail = document.createElement("pre");
    detail.textContent = notice.detail;
    detail.style.cssText = "white-space:pre-wrap;margin:0.5rem 0 0;max-height:10rem;overflow:auto";
    container.append(detail);
  }

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload application";
  reload.style.cssText = "margin-top:0.65rem;padding:0.35rem 0.65rem;cursor:pointer";
  reload.addEventListener("click", () => window.location.reload());
  container.append(reload);

  document.body.append(container);
}
