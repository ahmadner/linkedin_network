import { h } from "./dom";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise((resolve) => {
    const cancel = h("button", { type: "button", class: "secondary", value: "cancel" }, options.cancel ?? "تراجع");
    const ok = h("button", { type: "button", class: options.danger ? "danger" : "", value: "ok" }, options.confirm);
    const dialog = h("dialog", { class: "confirm", "aria-labelledby": "confirm-title", "aria-describedby": options.message ? "confirm-text" : null },
      h("h2", { id: "confirm-title" }, options.title),
      options.message ? h("p", { id: "confirm-text", class: "muted" }, options.message) : null,
      h("div", { class: "confirm-actions" }, cancel, ok),
    );
    let answer = false;
    cancel.addEventListener("click", () => dialog.close());
    ok.addEventListener("click", () => {
      answer = true;
      dialog.close();
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(answer);
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    (options.danger ? cancel : ok).focus();
  });
}
