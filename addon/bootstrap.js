/* SPDX-License-Identifier: GPL-3.0-or-later */
var pluginScope;

async function startup({ id, rootURI }) {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  pluginScope = { Zotero, Services, ChromeUtils, Cc, Ci, Cu, IOUtils, TextDecoder, TextEncoder, WebAssembly, setInterval, clearInterval };
  Services.scriptloader.loadSubScript(rootURI + "content/plugin.js", pluginScope);
  Zotero.LocalMDXClick = pluginScope.LocalMDXModule.createApp(pluginScope, id);
  await Zotero.LocalMDXClick.start();
}

function shutdown() {
  Zotero.LocalMDXClick?.stop();
  delete Zotero.LocalMDXClick;
  pluginScope = undefined;
}

function install() {}
function uninstall() {}
