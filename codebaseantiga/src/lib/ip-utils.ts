// IPv4 utilities: validation and input formatting

const IP_REGEX = /^(\d{2})\.(\d)\.(\d)\.(\d{2,3})$/;

export const isValidIPv4 = (ip: string): boolean => {
  if (!IP_REGEX.test(ip)) return false;
  const parts = ip.split(".").map(Number);
  return parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255);
};

// Sanitize IP input: keep only digits and dots, max format XX.X.X.XXX (final octet may have 2 digits)
export const formatIP = (val: string): string => {
  let cleaned = val.replace(/[^0-9.]/g, "");
  cleaned = cleaned.replace(/\.{2,}/g, ".");
  const parts = cleaned.split(".").slice(0, 4);
  const limits = [2, 1, 1, 3];
  const normalized = parts.map((part, index) => {
    let p = part.slice(0, limits[index] ?? 3);
    if (p.length > 0) {
      const n = parseInt(p, 10);
      if (!isNaN(n) && n > 255) p = "255";
    }
    return p;
  });
  return normalized.join(".");
};
