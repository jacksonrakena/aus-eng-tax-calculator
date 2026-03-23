// Parse a CSV line handling quoted fields (e.g. "$2,875.89")
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// Parse DD-Mon-YYYY (e.g. "18-Aug-2025") to a Date
function parseDMYDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, day, mon, year] = match;
  const monthNum = MONTHS[mon];
  if (monthNum === undefined) return null;
  return new Date(parseInt(year), monthNum, parseInt(day));
}

function dateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface RSURelease {
  releaseDate: Date;
  releaseDateStr: string;
  grantName: string;
  sharesVested: number;
  valueUSD: number;
  fmvPerShareUSD: number;
  referenceNumber: string;
}

export function parseRSUCSV(text: string): RSURelease[] {
  const lines = text.trim().split("\n");
  const releases: RSURelease[] = [];

  for (const line of lines) {
    const fields = parseCSVLine(line);
    // Data rows have a date in the Release Date column (index 7)
    if (fields.length < 15) continue;
    const releaseDate = parseDMYDate(fields[7]?.trim());
    if (!releaseDate) continue;

    const valueStr = fields[11]?.replace(/[$,]/g, "") ?? "";
    const fmvStr = fields[13]?.replace(/[$,]/g, "") ?? "";

    releases.push({
      releaseDate,
      releaseDateStr: fields[7].trim(),
      grantName: fields[5]?.trim() ?? "",
      sharesVested: parseInt(fields[8]) || 0,
      valueUSD: parseFloat(valueStr) || 0,
      fmvPerShareUSD: parseFloat(fmvStr) || 0,
      referenceNumber: fields[22]?.trim() ?? "",
    });
  }

  return releases;
}

/**
 * Parse the RBA F11.1 exchange rate CSV.
 * Returns a Map of date key (YYYY-MM-DD) to AUD/USD rate.
 * The rate represents "A$1 = X USD".
 */
export function parseExchangeRatesCSV(text: string): Map<string, number> {
  const lines = text.trim().split("\n");
  const rates = new Map<string, number>();

  for (const line of lines) {
    const fields = line.split(",");
    const date = parseDMYDate(fields[0]?.trim());
    if (!date) continue;
    const rate = parseFloat(fields[1]);
    if (isNaN(rate) || rate <= 0) continue;
    rates.set(dateToKey(date), rate);
  }

  return rates;
}

/**
 * Look up the AUD/USD exchange rate for a given date.
 * If the exact date has no rate (weekend/holiday), walks back up to 10 days.
 */
export function lookupExchangeRate(
  rates: Map<string, number>,
  date: Date
): number | null {
  const d = new Date(date);
  for (let i = 0; i < 10; i++) {
    const key = dateToKey(d);
    const rate = rates.get(key);
    if (rate !== undefined) return rate;
    d.setDate(d.getDate() - 1);
  }
  return null;
}
