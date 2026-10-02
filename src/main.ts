/** Assemble le moteur, le terminal, la persistance et les commandes de démarrage. */
import { NLC_CONFIG } from "./config";
import { VmLifecycle } from "./lifecycle/controller";
import { GoogleDriveSync } from "./persistence/drive";
import { IndexedDbStore } from "./persistence/indexeddb";
import { V86Engine } from "./v86/engine";
import { createTerminal } from "./terminal/terminal";
import "./style.css";

const terminal = createTerminal(document.querySelector<HTMLElement>("#terminal")!);
const store = new IndexedDbStore();
const lifecycle = new VmLifecycle(
  new V86Engine(terminal),
  store,
  NLC_CONFIG.assets.rootfs,
);
const drive = new GoogleDriveSync(store, NLC_CONFIG.googleClientId, NLC_CONFIG.driveFileName);
const status = document.querySelector<HTMLElement>("#status")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const freshButton = document.querySelector<HTMLButtonElement>("#fresh")!;
const memorySelector = document.querySelector<HTMLSelectElement>("#memory")!;
const googleButton = document.querySelector<HTMLButtonElement>("#connect-drive")!;

if (NLC_CONFIG.googleClientId) {
  googleButton.disabled = true;
  void drive
    .prepare()
    .then(() => {
      googleButton.disabled = false;
    })
    .catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : "Google Identity Services indisponible.";
      console.error("Préchargement de Google Identity Services impossible.", error);
    });
}

lifecycle.onStatus((state) => {
  status.textContent = state === "running" ? "VM en cours" : state;
  resumeButton.disabled = state === "starting" || state === "running" || state === "stopping";
  freshButton.disabled = resumeButton.disabled;
});
lifecycle.attachPageFlush();

void lifecycle.hasLocalSession().then((exists) => {
  resumeButton.hidden = !exists;
  resumeButton.textContent = exists ? "Reprendre la session" : "Démarrer sans compte";
});

async function start(resume: boolean): Promise<void> {
  try {
    await lifecycle.start(Number(memorySelector.value), resume);
    status.textContent = "VM en cours — sauvegarde locale active";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Erreur de démarrage inconnue.";
    console.error("Échec du démarrage NLC.", error);
  }
}

resumeButton.addEventListener("click", () => void start(true));
freshButton.addEventListener("click", async () => {
  try {
    await lifecycle.createNewSession();
    await start(false);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Erreur de création de session.";
  }
});
googleButton.addEventListener("click", async () => {
  try {
    await drive.connect();
    await lifecycle.startDriveSync(drive);
    if (!(await lifecycle.hasLocalSession()) && lifecycle.currentStatus === "idle") {
      const remoteDisk = await drive.download();
      if (remoteDisk && window.confirm("Une session Drive existe. La reprendre maintenant ?")) {
        await lifecycle.startFromDrive(Number(memorySelector.value), remoteDisk);
      }
    }
    status.textContent = "Google Drive connecté";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Connexion à Google Drive impossible.";
  }
});
