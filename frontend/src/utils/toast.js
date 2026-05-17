// Simple toast notification system
let toastTimeout;

export function showToast(message, duration = 2000) {
  // Remove existing toast
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  // Create toast
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className =
    "fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in";
  toast.textContent = message;

  document.body.appendChild(toast);

  // Auto-remove after duration
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("animate-fade-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
