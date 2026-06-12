export const FEATURES = {
  POS:           "pos",
  STOCK:         "stock",
  REPORTS:       "reports",
  ETIMS:         "etims",
  SETTINGS:      "settings",
  EDIT_PRODUCTS: "edit_products",
  VOID_SALES:    "void_sales",
};

export const ALL_FEATURES = Object.values(FEATURES);

// Default feature set granted by each named role
export const ROLE_PERMISSIONS = {
  admin:         ["pos", "stock", "reports", "etims", "settings", "edit_products", "void_sales"],
  sub_admin:     ["pos", "stock", "reports", "etims", "edit_products", "void_sales"],
  stock_keeper:  ["pos", "stock", "reports"],
  sales_manager: ["pos", "reports", "etims"],
  cashier:       ["pos", "reports"],
  custom:        [],
};

export const ROLE_LABELS = {
  admin:         "Admin",
  sub_admin:     "Sub-Admin",
  stock_keeper:  "Stock Keeper",
  sales_manager: "Sales Manager",
  cashier:       "Cashier",
  custom:        "Custom",
};

// Tailwind classes for role chips — light-mode (used inside white cards)
export const ROLE_COLORS = {
  admin:         "bg-yellow-100 text-yellow-700",
  sub_admin:     "bg-indigo-100 text-indigo-700",
  stock_keeper:  "bg-green-100 text-green-700",
  sales_manager: "bg-blue-100 text-blue-700",
  cashier:       "bg-gray-100 text-gray-600",
  custom:        "bg-purple-100 text-purple-700",
};

export const FEATURE_LABELS = {
  pos:           "POS — selling & cart",
  stock:         "Stock management",
  reports:       "Reports & daily summary",
  etims:         "eTIMS / KRA filing",
  settings:      "Shop settings & staff",
  edit_products: "Edit products & prices",
  void_sales:    "Void transactions",
};

// All selectable roles (admin is not an option when creating new staff)
export const ASSIGNABLE_ROLES = [
  { id: "cashier",       label: "Cashier",       desc: "POS + Reports" },
  { id: "stock_keeper",  label: "Stock Keeper",  desc: "POS + Stock + Reports" },
  { id: "sales_manager", label: "Sales Manager", desc: "POS + Reports + eTIMS" },
  { id: "sub_admin",     label: "Sub-Admin",     desc: "Everything except Settings" },
  { id: "custom",        label: "Custom",        desc: "Choose features manually" },
];
