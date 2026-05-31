/**
 * Smart price formatter that handles very small prices (e.g. PEPE $0.00000347)
 */
export const formatPrice = (price: number): string => {
  if (price === 0 || price == null) return "$0.0000";
  // Prices >= $1: 4 decimals (e.g. 1.2790 instead of 1.28) — Float Precision spec
  if (price >= 1) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  // Prices < $1: 6 decimals to capture small fractional moves
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  // Very small prices (PEPE, SHIB...): show enough decimals to reveal meaningful digits
  const str = price.toFixed(20);
  const match = str.match(/^0\.(0*[1-9]\d{0,5})/);
  if (match) return `$0.${match[1]}`;
  return `$${price.toFixed(10)}`;
};

export const formatNumber = (num: number): string => {
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  return `$${(num / 1e3).toFixed(1)}K`;
};
