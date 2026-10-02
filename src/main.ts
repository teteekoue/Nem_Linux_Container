/** Interface locale de test : démarrage Alpine, console série et sauvegarde IndexedDB. */
import { NLC_CONFIG } from "./config";
import { VmLifecycle } from "./lifecycle/controller";
import { IndexedDbStore } from "./persistence/indexeddb";
import { createTerminal, focusVmTerminal } from "./terminal/terminal";
import { V86Engine } from "./v86/engine";
import "./style.css";

const terminalContainer = document.querySelector<HTMLElement>("#terminal")!;
const terminal = createTerminal(terminalContainer);
const engine = new V86Engine(terminal);
const lifecycle = new VmLifecycle(
  engine,
  new IndexedDbStore(),
  NLC_CONFIG.assets.rootfs,
);
const status = document.querySelector<HTMLElement>("#status")!;
const statusIndicator = document.querySelector<HTMLElement>("#status-indicator")!;
const loading = document.querySelector<HTMLElement>("#loading")!;
const loadingMessage = document.querySelector<HTMLElement>("#loading-message")!;
const sessionChoice = document.querySelector<HTMLElement>("#session-choice")!;
const errorMessage = document.querySelector<HTMLElement>("#error-message")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const freshButton = document.querySelector<HTMLButtonElement>("#fresh")!;
const restartButton = document.querySelector<HTMLButtonElement>("#restart")!;
const clearSessionButton = document.querySelector<HTMLButtonElement>("#clear-session")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry")!;
const copyLogsButton = document.querySelector<HTMLButtonElement>("#copy-logs")!;
const downloadLogsButton = document.querySelector<HTMLButtonElement>("#download-logs")!;
const logActionStatus = document.querySelector<HTMLElement>("#log-action-status")!;

let retryResume = false;
let startInProgress = false;
const pendingDiagnosticOutput: string[] = [];
let diagnosticQueue = Promise.resolve();
let diagnosticsReady: Promise<boolean> | undefined;

engine.onSerialOutput((output) => {
  pendingDiagnosticOutput.push(output);
});

window.setInterval(() => {
  if (pendingDiagnosticOutput.length === 0 || !import.meta.env.DEV) return;
  const output = pendingDiagnosticOutput.join("");
  pendingDiagnosticOutput.length = 0;
  diagnosticQueue = diagnosticQueue
    .then(async () => {
      if (!(await initializeDiagnostics())) {
        pendingDiagnosticOutput.unshift(output);
        return;
      }
      const response = await fetch("/__nlc/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: output,
      });
      if (!response.ok) throw new Error(`Envoi des logs impossible (${response.status}).`);
    })
    .catch((error: unknown) => {
      pendingDiagnosticOutput.unshift(output);
      console.error("Collecte automatique des logs NLC impossible; nouvel essai programmé.", error);
    });
}, 1_000);

async function initializeDiagnostics(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  diagnosticsReady ??= fetch("/__nlc/diagnostics/reset", { method: "POST" })
    .then((response) => {
      if (!response.ok) throw new Error(`Serveur de diagnostics indisponible (${response.status}).`);
      return true;
    })
    .catch((error: unknown) => {
      diagnosticsReady = undefined;
      console.error("Initialisation de la collecte automatique des logs impossible.", error);
      return false;
    });
  return diagnosticsReady;
}

lifecycle.onStatus((state) => {
  status.textContent =
    state === "starting" || state === "idle"
      ? "Chargement…"
      : state === "running"
        ? "Prêt"
        : state === "error"
          ? "Erreur"
          : "Arrêt…";
  statusIndicator.dataset.state = state === "idle" ? "starting" : state;
  const busy = startInProgress || state === "starting" || state === "stopping";
  restartButton.disabled = busy || state === "idle";
  clearSessionButton.disabled = busy;
  if (state === "starting") loadingMessage.textContent = "Démarrage de la machine virtuelle…";
  if (state === "running") {
    loading.hidden = true;
    sessionChoice.hidden = true;
    errorMessage.hidden = true;
    retryButton.hidden = true;
    terminalContainer.hidden = false;
    focusVmTerminal(terminal);
  }
  if (state === "error") {
    loading.hidden = true;
    retryButton.hidden = false;
  }
});
lifecycle.attachPageFlush();

async function start(resume: boolean): Promise<void> {
  if (startInProgress) return;
  startInProgress = true;
  retryResume = resume;
  restartButton.disabled = true;
  clearSessionButton.disabled = true;
  resumeButton.disabled = true;
  freshButton.disabled = true;
  errorMessage.hidden = true;
  retryButton.hidden = true;
  sessionChoice.hidden = true;
  loading.hidden = false;
  terminalContainer.hidden = false;
  status.textContent = "Chargement…";
  statusIndicator.dataset.state = "starting";
  loadingMessage.textContent = resume
    ? "Restauration du disque et démarrage…"
    : "Téléchargement de l’image Alpine et démarrage…";
  try {
    await lifecycle.start(128, resume);
  } catch (error) {
    errorMessage.textContent =
      error instanceof Error ? error.message : "Une erreur inconnue a empêché le démarrage.";
    errorMessage.hidden = false;
    console.error("Échec du démarrage de la machine virtuelle.", error);
  } finally {
    startInProgress = false;
    restartButton.disabled = lifecycle.currentStatus === "idle";
    clearSessionButton.disabled =
      lifecycle.currentStatus === "starting" || lifecycle.currentStatus === "stopping";
    resumeButton.disabled = false;
    freshButton.disabled = false;
  }
}

resumeButton.addEventListener("click", () => void start(true));
freshButton.addEventListener("click", async () => {
  try {
    await lifecycle.createNewSession();
    await start(false);
  } catch (error) {
    showActionError(error);
  }
});
restartButton.addEventListener("click", async () => {
  try {
    await lifecycle.stop();
    await start(true);
  } catch (error) {
    showActionError(error);
  }
});
clearSessionButton.addEventListener("click", async () => {
  try {
    await lifecycle.createNewSession();
    await start(false);
  } catch (error) {
    showActionError(error);
  }
});
retryButton.addEventListener("click", () => void start(retryResume));
copyLogsButton.addEventListener("click", () => {
  void copyLogs();
});
downloadLogsButton.addEventListener("click", () => {
  const logs = engine.getSerialOutput();
  const url = URL.createObjectURL(new Blob([logs], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "nlc-logs.txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  logActionStatus.textContent = "Fichier de logs téléchargé.";
});

async function copyLogs(): Promise<void> {
  try {
    const logs = engine.getSerialOutput();
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(logs);
      } catch {
        copyWithSelectionFallback(logs);
      }
    } else {
      copyWithSelectionFallback(logs);
    }
    logActionStatus.textContent = "Logs copiés dans le presse-papiers.";
  } catch (error) {
    logActionStatus.textContent =
      error instanceof Error ? error.message : "Copie impossible; téléchargez plutôt les logs.";
  }
}

function copyWithSelectionFallback(logs: string): void {
  const field = document.createElement("textarea");
  field.value = logs;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copie refusée par le navigateur; téléchargez plutôt les logs.");
}

function showActionError(error: unknown): void {
  errorMessage.textContent =
    error instanceof Error ? error.message : "Une erreur inconnue est survenue.";
  errorMessage.hidden = false;
  retryButton.hidden = false;
  console.error("Échec de l’action sur la machine virtuelle.", error);
}

void (async () => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("reset-session") === "1") {
      url.searchParams.delete("reset-session");
      window.history.replaceState(null, "", url);
      await lifecycle.createNewSession();
      await start(false);
      return;
    }
    if (await lifecycle.hasLocalSession()) {
      loading.hidden = true;
      sessionChoice.hidden = false;
      status.textContent = "Session précédente détectée";
      statusIndicator.dataset.state = "idle";
      restartButton.disabled = true;
      clearSessionButton.disabled = false;
      terminalContainer.hidden = true;
      return;
    }
    await start(false);
  } catch (error: unknown) {
    status.textContent = "Erreur";
    statusIndicator.dataset.state = "error";
    loading.hidden = true;
    errorMessage.textContent =
      error instanceof Error ? error.message : "Lecture de la session locale impossible.";
    errorMessage.hidden = false;
    retryButton.hidden = false;
    console.error("Lecture de la session locale impossible.", error);
  }
})();
