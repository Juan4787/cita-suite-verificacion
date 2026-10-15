import { tick } from "svelte";

// Progressive enhancement keeps native form values, validation and Svelte bindings.
// Menus use the top layer, so dialogs and scrolling panels cannot clip them.
let nextId = 0;
const chevron =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
const calendarIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6m8-6v6M4 11h16"/></svg>';

function labelFor(source: HTMLInputElement | HTMLSelectElement) {
  const explicit = source.getAttribute("aria-label");
  if (explicit) return explicit;
  return (
    [...(source.labels ?? [])]
      .map((label) => {
        const copy = label.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll("input,select,textarea,button,.ux-control-error")
          .forEach((node) => node.remove());
        return copy.textContent?.trim() ?? "";
      })
      .join(" ") || "Elegir una opción"
  );
}

function shell(source: HTMLInputElement | HTMLSelectElement, icon: string) {
  const oldTabIndex = source.getAttribute("tabindex");
  const oldHidden = source.getAttribute("aria-hidden");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = source.className + " ux-control-trigger";
  trigger.setAttribute("aria-label", labelFor(source));
  const description = source.getAttribute("aria-describedby");
  if (description) trigger.setAttribute("aria-describedby", description);
  const text = document.createElement("span");
  const graphic = document.createElement("span");
  graphic.className = "ux-control-icon";
  graphic.innerHTML = icon;
  trigger.append(text, graphic);
  source.after(trigger);
  const error = document.createElement("span");
  error.className = "ux-control-error";
  error.id = `ux-error-${++nextId}`;
  error.hidden = true;
  trigger.after(error);
  source.classList.add("ux-native-source");
  source.tabIndex = -1;
  source.setAttribute("aria-hidden", "true");
  const menu = document.createElement("div");
  menu.className = "ux-control-menu";
  menu.id = `ux-options-${++nextId}`;
  const topLayer = typeof menu.showPopover === "function";
  if (topLayer) menu.setAttribute("popover", "manual");
  else menu.hidden = true;
  menu.classList.toggle("booking-control-menu-natalia", !!source.closest(".booking-natalia"));
  document.body.append(menu);
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute("aria-expanded", "false");
  let open = false;
  let nameSuffix = "";
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(160, Math.min(360, window.innerHeight - 32))}px`;
    const height = Math.min(menu.scrollHeight, 360, window.innerHeight - 32);
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    menu.style.top = `${rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)}px`;
  };
  const close = () => {
    if (!open) return;
    open = false;
    if (topLayer) menu.hidePopover();
    else menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  };
  const show = () => {
    if (source.matches(":disabled")) return;
    open = true;
    if (topLayer) menu.showPopover();
    else menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
  };
  const outside = (event: PointerEvent) => {
    if (
      !menu.contains(event.target as Node) &&
      !trigger.contains(event.target as Node)
    )
      close();
  };
  const onScroll = (event: Event) => {
    if (open && !menu.contains(event.target as Node)) {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) close();
      else position();
    }
  };
  const onInvalid = (event: Event) => {
    event.preventDefault();
    trigger.setAttribute("aria-invalid", "true");
    error.textContent =
      source instanceof HTMLSelectElement
        ? "Elegí una opción para continuar."
        : "Elegí una fecha para continuar.";
    error.hidden = false;
    trigger.setAttribute(
      "aria-describedby",
      [description, error.id].filter(Boolean).join(" "),
    );
    if (
      !source.form?.querySelector('[aria-invalid="true"]') ||
      source.form.querySelector('[aria-invalid="true"]') === trigger
    )
      trigger.focus();
  };
  const onFocus = () => trigger.focus();
  const sync = () => {
    trigger.disabled = source.matches(":disabled");
    trigger.setAttribute("aria-label", labelFor(source) + nameSuffix);
    if (trigger.disabled) close();
    if (source.validity.valid) {
      trigger.removeAttribute("aria-invalid");
      error.hidden = true;
      if (description) trigger.setAttribute("aria-describedby", description);
      else trigger.removeAttribute("aria-describedby");
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(source, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  const fieldset = source.closest("fieldset");
  if (fieldset)
    observer.observe(fieldset, {
      attributes: true,
      attributeFilter: ["disabled"],
    });
  document.addEventListener("pointerdown", outside);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", close);
  source.addEventListener("invalid", onInvalid);
  source.addEventListener("focus", onFocus);
  return {
    trigger,
    text,
    menu,
    show,
    close,
    position,
    sync,
    setNameSuffix(value: string) {
      nameSuffix = value;
      trigger.setAttribute("aria-label", labelFor(source) + nameSuffix);
    },
    get open() {
      return open;
    },
    destroy() {
      observer.disconnect();
      close();
      menu.remove();
      trigger.remove();
      error.remove();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      source.removeEventListener("invalid", onInvalid);
      source.removeEventListener("focus", onFocus);
      source.classList.remove("ux-native-source");
      if (oldTabIndex === null) source.removeAttribute("tabindex");
      else source.setAttribute("tabindex", oldTabIndex);
      if (oldHidden === null) source.removeAttribute("aria-hidden");
      else source.setAttribute("aria-hidden", oldHidden);
    },
  };
}

export function styledSelect(source: HTMLSelectElement, _value?: unknown) {
  if (source.multiple) return {};
  const ui = shell(source, chevron);
  ui.trigger.setAttribute("role", "combobox");
  ui.trigger.setAttribute("aria-haspopup", "listbox");
  ui.menu.setAttribute("role", "listbox");
  ui.menu.setAttribute("aria-label", labelFor(source));
  let active = -1;
  let search = "";
  let lastTyped = 0;
  const options = () => [...source.options];
  const setActive = (index: number) => {
    active = index;
    const items = [...ui.menu.children] as HTMLElement[];
    items.forEach((item, i) =>
      item.classList.toggle("is-active", i === active),
    );
    if (items[active]) {
      ui.trigger.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView?.({ block: "nearest" });
    }
  };
  const sync = () => {
    ui.sync();
    ui.text.textContent =
      source.options[source.selectedIndex]?.textContent || "Elegir";
    ui.menu.replaceChildren(
      ...options().map((option, index) => {
        const item = document.createElement("div");
        item.id = `${ui.menu.id}-${index}`;
        item.className = "ux-control-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.setAttribute("aria-disabled", String(option.disabled));
        item.textContent = option.text;
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        item.addEventListener("click", (event) => {
          event.preventDefault();
          if (!option.disabled) choose(index);
        });
        return item;
      }),
    );
    if (ui.open) setActive(active);
  };
  const choose = async (index: number) => {
    source.selectedIndex = index;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
    ui.close();
    ui.trigger.focus();
    await tick();
    sync();
  };
  const open = () => {
    sync();
    ui.show();
    setActive(Math.max(0, source.selectedIndex));
  };
  ui.trigger.addEventListener("click", () => (ui.open ? ui.close() : open()));
  ui.trigger.addEventListener("keydown", (event) => {
    const list = options();
    if (event.key === "Escape" || event.key === "Tab") {
      if (ui.open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      ui.close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!ui.open) open();
      const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
      let index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? list.length - 1
            : Math.max(0, Math.min(list.length - 1, active + direction));
      while (list[index]?.disabled && index >= 0 && index < list.length)
        index += direction;
      if (list[index] && !list[index].disabled) setActive(index);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!ui.open) open();
      else if (active >= 0 && !list[active]?.disabled) void choose(active);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!ui.open) open();
      const now = Date.now();
      search = now - lastTyped > 600 ? event.key : search + event.key;
      lastTyped = now;
      const index = list.findIndex(
        (option) =>
          !option.disabled &&
          option.text
            .toLocaleLowerCase()
            .startsWith(search.toLocaleLowerCase()),
      );
      if (index >= 0) setActive(index);
    }
  });
  const onChange = () => {
    void tick().then(sync);
  };
  source.addEventListener("change", onChange);
  const observer = new MutationObserver(() => {
    void tick().then(sync);
  });
  observer.observe(source, { childList: true, subtree: true });
  sync();
  void tick().then(sync);
  return {
    update(_next: unknown) {
      void tick().then(sync);
    },
    destroy() {
      observer.disconnect();
      source.removeEventListener("change", onChange);
      ui.destroy();
    },
  };
}

export function styledDate(source: HTMLInputElement, _value?: unknown) {
  const monthOnly = source.type === "month";
  const ui = shell(source, calendarIcon);
  ui.trigger.setAttribute("aria-haspopup", "dialog");
  ui.menu.setAttribute("role", "dialog");
  ui.menu.setAttribute("aria-label", labelFor(source));
  let view = new Date();
  const iso = (year: number, month: number, day = 1) =>
    `${year}-${String(month + 1).padStart(2, "0")}${monthOnly ? "" : "-" + String(day).padStart(2, "0")}`;
  const inRange = (value: string) =>
    (!source.min || value >= source.min) &&
    (!source.max || value <= source.max);
  const sync = () => {
    ui.sync();
    const value = source.value;
    ui.text.textContent = value
      ? new Intl.DateTimeFormat(
          "es-AR",
          monthOnly
            ? { month: "long", year: "numeric" }
            : { day: "2-digit", month: "short", year: "numeric" },
        ).format(new Date(value + (monthOnly ? "-01" : "") + "T12:00:00"))
      : monthOnly
        ? "Elegir mes"
        : "Elegir fecha";
    ui.setNameSuffix(`, ${ui.text.textContent}`);
  };
  const choose = async (value: string) => {
    source.value = value;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
    ui.close();
    ui.trigger.focus();
    await tick();
    sync();
  };
  const render = () => {
    const year = view.getFullYear(),
      month = view.getMonth();
    ui.menu.replaceChildren();
    const header = document.createElement("div");
    header.className = "ux-calendar-header";
    for (const direction of [-1, 0, 1]) {
      if (!direction) {
        const title = document.createElement("span");
        title.textContent = monthOnly
          ? String(year)
          : new Intl.DateTimeFormat("es-AR", {
              month: "long",
              year: "numeric",
            }).format(view);
        header.append(title);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ux-calendar-nav";
      button.setAttribute(
        "aria-label",
        direction < 0
          ? monthOnly
            ? "Año anterior"
            : "Mes anterior"
          : monthOnly
            ? "Año siguiente"
            : "Mes siguiente",
      );
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction < 0 ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"}"/></svg>`;
      button.onclick = () => {
        view = new Date(
          year + (monthOnly ? direction : 0),
          month + (monthOnly ? 0 : direction),
          1,
        );
        render();
        ui.menu
          .querySelectorAll<HTMLButtonElement>(".ux-calendar-nav")
          [direction < 0 ? 0 : 1]?.focus();
      };
      header.append(button);
    }
    ui.menu.append(header);
    const grid = document.createElement("div");
    grid.className = monthOnly ? "ux-calendar-months" : "ux-calendar-days";
    if (!monthOnly) {
      for (const weekday of ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"]) {
        const label = document.createElement("span");
        label.className = "ux-calendar-weekday";
        label.textContent = weekday;
        grid.append(label);
      }
      const lead = (new Date(year, month, 1).getDay() + 6) % 7;
      for (let i = 0; i < lead; i++)
        grid.append(document.createElement("span"));
    }
    const count = monthOnly ? 12 : new Date(year, month + 1, 0).getDate();
    for (let index = 0; index < count; index++) {
      const value = iso(year, monthOnly ? index : month, index + 1);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ux-calendar-value";
      button.textContent = monthOnly
        ? new Intl.DateTimeFormat("es-AR", { month: "short" }).format(
            new Date(year, index, 1),
          )
        : String(index + 1);
      button.disabled = !inRange(value);
      button.setAttribute("aria-pressed", String(value === source.value));
      button.dataset.value = value;
      button.setAttribute(
        "aria-label",
        new Intl.DateTimeFormat(
          "es-AR",
          monthOnly
            ? { month: "long", year: "numeric" }
            : { day: "numeric", month: "long", year: "numeric" },
        ).format(
          new Date(year, monthOnly ? index : month, monthOnly ? 1 : index + 1),
        ),
      );
      button.onclick = () => {
        void choose(value);
      };
      grid.append(button);
    }
    ui.menu.append(grid);
    if (!source.required) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "ux-calendar-clear";
      clear.textContent = "Quitar fecha";
      clear.onclick = () => {
        void choose("");
      };
      ui.menu.append(clear);
    }
    ui.position();
  };
  ui.trigger.onclick = () => {
    if (ui.open) {
      ui.close();
      return;
    }
    const initial = source.value || source.min;
    view = initial
      ? new Date(initial + (monthOnly ? "-01" : "") + "T12:00:00")
      : new Date();
    render();
    ui.show();
    (
      ui.menu.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      ui.menu.querySelector<HTMLButtonElement>(
        ".ux-calendar-value:not(:disabled)",
      )
    )?.focus({ preventScroll: true });
  };
  ui.menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      ui.close();
      ui.trigger.focus();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = [
        ...ui.menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      buttons[
        (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
      ]?.focus();
      return;
    }
    const movement: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: monthOnly ? -3 : -7,
      ArrowDown: monthOnly ? 3 : 7,
    };
    if (event.key in movement) {
      event.preventDefault();
      const buttons = [
        ...ui.menu.querySelectorAll<HTMLButtonElement>(".ux-calendar-value"),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next = buttons[index + movement[event.key]];
      if (next && !next.disabled) next.focus();
    }
  });
  ui.trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.open) {
      event.stopPropagation();
      ui.close();
    }
  });
  const onChange = () => {
    void tick().then(sync);
  };
  source.addEventListener("change", onChange);
  sync();
  void tick().then(sync);
  return {
    update(_next: unknown) {
      void tick().then(sync);
    },
    destroy() {
      source.removeEventListener("change", onChange);
      ui.destroy();
    },
  };
}

export function styledTime(source: HTMLInputElement) {
  const originalType = source.type;
  source.type = "text";
  source.inputMode = "numeric";
  source.placeholder = "HH:mm";
  source.pattern = "([01][0-9]|2[0-3]):[0-5][0-9]";
  source.maxLength = 5;
  const normalize = () => {
    const digits = source.value.replace(/\D/g, "");
    if (!digits) return;
    if (digits.length === 4 || digits.length <= 2) {
      source.value =
        digits.length <= 2
          ? digits.padStart(2, "0") + ":00"
          : digits.slice(0, 2) + ":" + digits.slice(2);
      source.dispatchEvent(new Event("input", { bubbles: true }));
      source.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  source.addEventListener("blur", normalize);
  return {
    destroy() {
      source.removeEventListener("blur", normalize);
      source.type = originalType;
    },
  };
}
