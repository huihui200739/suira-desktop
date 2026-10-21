const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'assets', 'brand.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'assets', 'logo.png'), image.toPNG());
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), image.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  win.destroy(); app.quit();
});
