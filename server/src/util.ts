export function shortAddr(address: string, size = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export function isAddressLike(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** Strip API keys from strings before they reach logs, activity, or the UI. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\/v2\/[A-Za-z0-9_\-]{8,}/g, "/v2/***")
    .replace(/alch_[A-Za-z0-9_\-]{6,}/g, "alch_***")
    .replace(/([?&](?:api[-_]?key|apikey|token)=)[^&\s]+/gi, "$1***");
}
