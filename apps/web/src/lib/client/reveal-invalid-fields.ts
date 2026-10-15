// Native form validation must be able to focus a required field inside disclosures.
export function revealInvalidFields(form: HTMLFormElement) {
  const reveal = (event: Event) => {
    let ancestor = (event.target as HTMLElement).parentElement;
    while (ancestor && ancestor !== form) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
  };
  form.addEventListener("invalid", reveal, true);
  return { destroy: () => form.removeEventListener("invalid", reveal, true) };
}
