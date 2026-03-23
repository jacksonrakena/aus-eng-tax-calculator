export interface TaxBracket {
  from: number;
  to: number;
  rate: number;
  label: string;
}

// FY2026 Australian individual income tax rates (resident)
// https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
export const FY2026_BRACKETS: TaxBracket[] = [
  { from: 0, to: 18_200, rate: 0, label: "$0 – $18,200" },
  { from: 18_200, to: 45_000, rate: 0.16, label: "$18,201 – $45,000" },
  { from: 45_000, to: 135_000, rate: 0.3, label: "$45,001 – $135,000" },
  { from: 135_000, to: 190_000, rate: 0.37, label: "$135,001 – $190,000" },
  { from: 190_000, to: Infinity, rate: 0.45, label: "$190,001+" },
];

export const MEDICARE_LEVY_RATE = 0.02;

export interface BracketBreakdown {
  label: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface TaxSummary {
  brackets: BracketBreakdown[];
  incomeTax: number;
  medicareLevy: number;
  totalTax: number;
  effectiveRate: number;
}

export function calculateTaxSummary(taxableIncome: number): TaxSummary {
  const income = Math.max(0, Math.round(taxableIncome));

  const brackets: BracketBreakdown[] = FY2026_BRACKETS.map((bracket) => {
    if (income <= bracket.from) {
      return {
        label: bracket.label,
        rate: bracket.rate,
        taxableAmount: 0,
        taxAmount: 0,
      };
    }
    const upper = Math.min(income, bracket.to);
    const taxableAmount = upper - bracket.from;
    const taxAmount = taxableAmount * bracket.rate;
    return { label: bracket.label, rate: bracket.rate, taxableAmount, taxAmount };
  });

  const incomeTax = brackets.reduce((sum, b) => sum + b.taxAmount, 0);
  const medicareLevy = income * MEDICARE_LEVY_RATE;
  const totalTax = incomeTax + medicareLevy;
  const effectiveRate = income > 0 ? totalTax / income : 0;

  return { brackets, incomeTax, medicareLevy, totalTax, effectiveRate };
}
