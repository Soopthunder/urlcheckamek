// SiteCheck de escritorio: levanta el server standalone de Next adentro de este
// mismo proceso (solo en 127.0.0.1), abre la ventana y corre el chequeo cada 30 min.
// Cerrar la ventana la manda a la bandeja; "Salir" desde la bandeja cierra de verdad.
const { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");

const CHECK_EVERY_MS = 30 * 60 * 1000;

// one instance only: two copies would race on db.json and double the scheduler
if (!app.requestSingleInstanceLock()) app.quit();

const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const serverDir = app.isPackaged ? path.join(root, "server") : path.join(root, ".next", "standalone");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// The agents' folder is user-editable, so it is never blindly overwritten:
// - first run: copy the template.
// - new app version: back up the whole folder, then refresh the instructions (AGENTS.md,
//   contexto/, skills/) that the new pipeline depends on; memory, projects and the user's
//   config are kept (config only gains the new keys).
// ponytail: an edited prompt is replaced on upgrade (it stays in the backup). Merge per file
// if users start customizing prompts heavily.
function prepararWorkspace(plantilla, workspace, dataDir) {
  const marca = path.join(workspace, ".version");
  const version = app.getVersion();
  if (!fs.existsSync(workspace)) {
    fs.cpSync(plantilla, workspace, { recursive: true });
  } else if ((fs.existsSync(marca) ? fs.readFileSync(marca, "utf8").trim() : "") !== version) {
    const respaldo = path.join(dataDir, `workspace-respaldo-${new Date().toISOString().slice(0, 16).replace(/:/g, "-")}`);
    fs.cpSync(workspace, respaldo, { recursive: true, filter: (src) => !src.includes(`${path.sep}proyectos${path.sep}`) });
    for (const p of ["AGENTS.md", "contexto", "skills"]) {
      fs.cpSync(path.join(plantilla, p), path.join(workspace, p), { recursive: true, force: true });
    }
    // solo lo que falte (el instalador no trae proyectos/: se crea al auditar)
    const memoria = path.join(plantilla, "memoria");
    if (fs.existsSync(memoria)) fs.cpSync(memoria, path.join(workspace, "memoria"), { recursive: true, force: false });
    const leer = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
    const cfg = path.join(workspace, "config.json");
    const nuevo = { ...leer(path.join(plantilla, "config.json")), ...(fs.existsSync(cfg) ? leer(cfg) : {}) };
    fs.writeFileSync(cfg, JSON.stringify(nuevo, null, 2) + "\n");
  }
  fs.writeFileSync(marca, version);
}

async function startServer() {
  const dataDir = app.getPath("userData"); // %APPDATA%/SiteCheck
  const workspace = path.join(dataDir, "workspace");
  prepararWorkspace(path.join(root, "workspace"), workspace, dataDir);

  const port = await freePort();
  Object.assign(process.env, {
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATA_DIR: dataDir,
    WORKSPACE_DIR: workspace,
    NTFY_TOPIC: process.env.NTFY_TOPIC ?? "sitecheck-amek-5bb261eb27", // phone push, see README
  });
  require(path.join(serverDir, "server.js"));

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url + "/api/links")).ok) return url;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("El servidor interno no arrancó en 30 s");
}

let win = null;
let tray = null; // module-level: a local Tray gets garbage-collected and the icon vanishes
let quitting = false;
const iconPath = path.join(serverDir, "public", "icon-512.png");
const startedAtLogin = process.argv.includes("--hidden");

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function checkNow(url) {
  try {
    const { down } = await (await fetch(url + "/api/check")).json();
    if (down > 0 && Notification.isSupported()) {
      const n = new Notification({ title: "SiteCheck", body: `${down} sitio(s) caído(s)`, icon: iconPath });
      n.on("click", showWindow);
      n.show();
    }
  } catch {} // ponytail: next tick retries; the dashboard shows the last good results
}

app.whenReady().then(async () => {
  let url;
  try {
    url = await startServer();
  } catch (err) {
    dialog.showErrorBox("SiteCheck no pudo iniciar", String(err?.stack ?? err));
    return app.quit();
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: !startedAtLogin,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    icon: iconPath,
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target); // site links open in the user's browser
    return { action: "deny" };
  });
  win.loadURL(url);
  // closing the window hides it to the tray so the 30-min checks keep running
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  app.on("second-instance", showWindow);

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip("SiteCheck — monitoreando cada 30 min");
  const loginArgs = { args: ["--hidden"] };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir SiteCheck", click: showWindow },
      { label: "Chequear ahora", click: () => checkNow(url) },
      { type: "separator" },
      {
        label: "Iniciar con Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings(loginArgs).openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, ...loginArgs }),
      },
      { type: "separator" },
      { label: "Salir", click: () => { quitting = true; app.quit(); } },
    ])
  );

  tray.on("click", showWindow);

  checkNow(url);
  setInterval(() => checkNow(url), CHECK_EVERY_MS);
});

app.on("before-quit", () => (quitting = true));
