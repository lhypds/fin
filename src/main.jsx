import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "ress";
import "./global.css";
import "./i18n/index.js";
import App from "./App.jsx";

// Cmd/Ctrl+S never saves the page as HTML: the app keeps its own data, and a dialog with something
// to save takes the key for itself.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") e.preventDefault();
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
