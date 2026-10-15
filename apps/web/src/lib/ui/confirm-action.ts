import { beforeNavigate, goto } from "$app/navigation";

let pending: Promise<boolean> | null = null;
export function confirmAction(message: string, accept = "Descartar cambios") {
  if (pending) return pending;
  pending = new Promise<boolean>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className = "ux-confirm-dialog";
    const heading = document.createElement("h2");
    heading.id = "ux-confirm-title";
    heading.textContent = "Cambios sin guardar";
    dialog.setAttribute("aria-labelledby", heading.id);
    const text = document.createElement("p");
    text.textContent = message;
    const actions = document.createElement("div");
    actions.className = "ux-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ux-btn-secondary";
    cancel.textContent = "Seguir editando";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "ux-btn-primary";
    confirm.textContent = accept;
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      pending = null;
      if (previous?.isConnected) previous.focus();
      resolve(result);
    };
    cancel.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    actions.append(cancel, confirm);
    dialog.append(heading, text, actions);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
  return pending;
}

export function guardUnsavedChanges(
  dirty: () => boolean,
  message: string,
  discard: () => void,
) {
  let allowed = false;
  let waiting = false;
  beforeNavigate((navigation) => {
    if (allowed || !dirty()) return;
    if (navigation.willUnload) {
      navigation.cancel();
      return;
    }
    if (!navigation.to) return;
    navigation.cancel();
    if (waiting) return;
    waiting = true;
    void confirmAction(message).then(async (accepted) => {
      if (!accepted) {
        waiting = false;
        return;
      }
      discard();
      allowed = true;
      try {
        await goto(navigation.to!.url, {
          replaceState: navigation.type === "popstate",
        });
      } finally {
        allowed = false;
        waiting = false;
      }
    });
  });
}
