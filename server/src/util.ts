export function shortAddr(address: string, size = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export function isAddressLike(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}
