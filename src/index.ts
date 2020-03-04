import { app, BrowserWindow, desktopCapturer, shell } from 'electron';
declare const MAIN_WINDOW_WEBPACK_ENTRY: any;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const createWindow = () => {
  app.allowRendererProcessReuse = true;
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 600,
    width: 800,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      enableRemoteModule: false
    }
  });

  process.env['ELECTRON_ENABLE_SECURITY_WARNINGS'] = 'true';

  /*const { session } = require('electron')

  session.defaultSession.webRequest.onHeadersReceived((details: any, callback: Function) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['default-src \'none\'']
      }
    })
  })*/

  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload
  
      // Disable Node.js integration
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.contextIsolation = true;
  
      // Verify URL being loaded
      if (!params.src.startsWith('https://')) {
        event.preventDefault()
      }
    })

    contents.on('new-window', async (event, navigationUrl) => {
      // In this example, we'll ask the operating system
      // to open this event's url in the default browser.
      event.preventDefault()
  
      await shell.openExternal(navigationUrl)
    })
  })

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  app.quit();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
