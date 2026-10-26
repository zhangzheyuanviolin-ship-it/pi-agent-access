/** Keep plain Tab inside the innermost active modal; VoiceOver chords stay untouched. */
export function trapDialogTab(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: EventTarget | null; preventDefault(): void }, panel: HTMLElement | null): void {
  if (!panel || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== panel) return;
  const controls = Array.from(panel.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]'))
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [aria-disabled="true"]') && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0);
  if (!controls.length) { event.preventDefault(); panel.focus(); return; }
  const active = panel.ownerDocument.activeElement;
  if (event.shiftKey && (active === controls[0] || active === panel)) { event.preventDefault(); controls.at(-1)!.focus(); }
  else if (!event.shiftKey && (active === controls.at(-1) || active === panel)) { event.preventDefault(); controls[0].focus(); }
}
