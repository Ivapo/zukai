import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Overpass — an open typeface based on the FHWA Highway Gothic road-sign face —
// gives Zukai its signage-rooted identity. Loaded locally, no runtime network.
import "@fontsource/overpass/400.css";
import "@fontsource/overpass/500.css";
import "@fontsource/overpass/600.css";
import "@fontsource/overpass/700.css";
import "@fontsource/overpass-mono/400.css";
import "@fontsource/overpass-mono/500.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
