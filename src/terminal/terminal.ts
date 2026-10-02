import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/** Création du terminal xterm.js utilisé comme console série de v86. */
export function createTerminal(container: HTMLElement): Terminal {
  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    theme: { background: "#111827", foreground: "#e5e7eb", cursor: "#34d399" },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  fit.fit();
  window.addEventListener("resize", () => fit.fit());
  return terminal;
}
