// Simple toast notification system
let toastTimeout;

export function showToast(message, duration = 2000) {
  // Remove existing toast
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  // Create toast
  const toast = document.createElement("div");
  toast.id = "toast";
  // Clears the bottom nav *and* the running-total cart bar above it on phones.
  // At lg both are gone, so it drops to the bottom edge — still centred, which
  // keeps it clear of the navigation rail and the cart rail either side.
  toast.className =
    "fixed bottom-32 lg:bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg ring-1 ring-white/10 z-50 animate-fade-in";
  toast.textContent = message;

  document.body.appendChild(toast);

  // Auto-remove after duration
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("animate-fade-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
