import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import db from "./services/db";

// Initialize database
db.open().catch((err) => {
  console.error("Failed to open database:", err);
});

// Log database info
console.log("📦 Dzeline Shop - Database initialized");
console.log(
  "🔌 Service Worker:",
  "workbox" in window ? "Loaded" : "Not loaded",
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
