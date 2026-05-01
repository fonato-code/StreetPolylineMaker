import { KmlExplorerApp } from "./kml-explorer-app.js";
import { initKmlExplorerSidebarResize } from "./kml-explorer-layout.js";

initKmlExplorerSidebarResize({
  bodyEl: document.querySelector(".kml-explorer-body"),
  sidebar: document.querySelector(".kml-explorer-sidebar"),
  resizer: document.querySelector(".kml-explorer-resizer"),
});

new KmlExplorerApp();
