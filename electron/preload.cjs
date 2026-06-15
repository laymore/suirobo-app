/**
 * Preload — exposes two things to the React renderer:
 *  1. SUIROBO_DESKTOP flag → trims the UI to Trade + Backtest + My Bot.
 *  2. suiroboDesktop.saveKey() → persists the user's private key in the app's
 *     install dir and (re)starts the bundled agent with it, so the agent derives
 *     the wallet address and signs trades. No browser wallet extension needed.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SUIROBO_DESKTOP', true);
contextBridge.exposeInMainWorld('suiroboDesktop', {
  saveKey:    (key) => ipcRenderer.invoke('suirobo:saveKey', key),
  clearKey:   ()    => ipcRenderer.invoke('suirobo:clearKey'),
  hasKey:     ()    => ipcRenderer.invoke('suirobo:hasKey'),
});
