import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, shell } from 'electron'
import { registerIpc } from './ipc.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: join(dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The render loop drives the physics step, so the usual background
      // throttling would nearly stop the simulation whenever the window is not
      // in front — leaving a running skill stalled mid-action while the model
      // waits on it. A simulation has to keep ticking when you look away.
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // External links open in the real browser, never in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
