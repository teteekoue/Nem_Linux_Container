import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/** Crée le terminal visible qui sera relié directement au port série de v86. */
export function createTerminal(container: HTMLElement): Terminal {
  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    scrollback: 10_000,
    theme: { background: "#111827", foreground: "#e5e7eb", cursor: "#34d399" },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  fit.fit();
  new ResizeObserver(() => fit.fit()).observe(container);
  return terminal;
}

/** Rend le focus au terminal xterm connecté à la VM. */
export function focusVmTerminal(terminal: Terminal): void {
  terminal.focus();
}
