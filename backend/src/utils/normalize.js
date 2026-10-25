const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toAsciiDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (ch) => {
    const i = ARABIC_INDIC_DIGITS.indexOf(ch);
    return i >= 0 ? String(i) : ch;
  });
}

/** Order # from Excel "Order" column — same key for comments across uploads. */
export function normalizeOrderNo(value) {
  if (value === null || value === undefined) return "";
  let s = toAsciiDigits(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    s = String(value);
  } else {
    s = String(s).trim();
  }
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (/\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return collapseWhitespace(s);
}

export function isPendingSdmStage(stage) {
  return normalizeKey(stage) === normalizeKey("Pending SDM");
}

export function collapseWhitespace(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeKey(value) {
  return collapseWhitespace(value).toLowerCase();
}

export function normalizeHeader(value) {
  return collapseWhitespace(value);
}

export function msisdnToText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  let s = String(value).trim();
  if (/\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}

/** Clean SFA for distinct counting: string, trim, drop float ".0"; empty/NaN → "". */
export function normalizeSfa(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(Math.trunc(value));
  }
  let s = String(value).trim();
  if (!s || /^nan$/i.test(s)) return "";
  if (/\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s.trim();
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function toMonth(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getMonth() + 1;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1 && value <= 12) return Math.trunc(value);

    const serialDate = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isNaN(serialDate.getTime())) {
      const month = serialDate.getUTCMonth() + 1;
      if (month >= 1 && month <= 12) return month;
    }
    return null;
  }

  const s = String(value).trim();
  if (!s) return null;

  const direct = Number(s);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 12)
    return Math.trunc(direct);

  const monthNames = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ]);

  const dayMonthYear = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})$/);
  if (dayMonthYear) {
    const month = monthNames.get(dayMonthYear[2].toLowerCase());
    if (month) return month;
  }

  const monthByName = s.match(/^(?:\d{1,2}\s+)?([a-zA-Z]+)\s*(?:\d{2,4})?$/);
  if (monthByName) {
    const month = monthNames.get(monthByName[1].toLowerCase());
    if (month) return month;
  }

  const slashMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const c = Number(slashMatch[3]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12) return a;
    if (a > 12 && b >= 1 && b <= 12) return b;
    if (b > 12 && a >= 1 && a <= 12) return a;
    if (c > 0 && c <= 12) return c;
  }

  const isoMatch = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) return month;
  }

  const date = new Date(s);
  if (!Number.isNaN(date.getTime())) {
    const month = date.getMonth() + 1;
    if (month >= 1 && month <= 12) return month;
  }

  return null;
}

export function normalizeType(value) {
  return normalizeKey(value);
}

export function isGarbageStatusLabel(value) {
  const s = collapseWhitespace(value);
  if (!s || s === "**") return true;
  if (/^\d{10,}$/.test(s.replace(/\s/g, ""))) return true;
  return false;
}

export function defaultStatusLabel(sheetStatus) {
  if (sheetStatus === "applied") return "Applied";
  if (sheetStatus === "underActivation") return "Pending";
  if (sheetStatus === "lost") return "Lost";
  return "";
}

export function normalizeOrderStatusText(raw, sheetStatus, fallback = "") {
  const s = collapseWhitespace(raw);
  if (!isGarbageStatusLabel(s)) return s || fallback || defaultStatusLabel(sheetStatus);
  const fb = collapseWhitespace(fallback);
  if (!isGarbageStatusLabel(fb)) return fb || defaultStatusLabel(sheetStatus);
  return defaultStatusLabel(sheetStatus);
}
