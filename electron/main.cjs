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

async function startServer() {
  const dataDir = app.getPath("userData"); // %APPDATA%/SiteCheck
  const workspace = path.join(dataDir, "workspace");
  // first run: copy the agent templates where the user can edit them; never overwrite edits
  if (!fs.existsSync(workspace)) fs.cpSync(path.join(root, "workspace"), workspace, { recursive: true });

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
