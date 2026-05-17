export const formatPrice = (amount) => {
  return `KES ${Number(amount).toFixed(2)}`;
};

export const formatDate = (timestamp) => {
  return new Intl.DateTimeFormat("en-KE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

export const calculateVAT = (amount, rate = 0.16) => {
  return amount * rate;
};

export const calculateTotal = (subtotal, vat) => {
  return subtotal + vat;
};
