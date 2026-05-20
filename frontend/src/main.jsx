import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import db from "./services/db";

db.open().catch((err) => {
  console.error("Failed to open database:", err);
});

console.log("📦 Dzeline Shop - Database initialized");
console.log(
  "🔌 Service Worker:",
  "serviceWorker" in navigator ? "Supported" : "Not supported",
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
