import { useState, useEffect, useMemo, useRef } from "react";
import {
  parseRSUCSV,
  parseExchangeRatesCSV,
  lookupExchangeRate,
  type RSURelease,
} from "./utils/csv";
import { calculateTaxSummary, MEDICARE_LEVY_RATE } from "./utils/tax";
import "./App.css";

const FY_START = new Date(2025, 6, 1); // 1 July 2025
const FY_END = new Date(2026, 5, 30); // 30 June 2026
const MS_PER_DAY = 86_400_000;
const TOTAL_FY_DAYS =
  Math.floor((FY_END.getTime() - FY_START.getTime()) / MS_PER_DAY) + 1; // 365

function daysElapsedInFY(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const clamped = new Date(
    Math.max(FY_START.getTime(), Math.min(today.getTime(), FY_END.getTime())),
  );
  return Math.floor((clamped.getTime() - FY_START.getTime()) / MS_PER_DAY) + 1;
}

const formatAUD = (amount: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(amount);

const formatUSD = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);

const formatPct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

interface RSUReleaseWithAUD extends RSURelease {
  exchangeRate: number | null;
  valueAUD: number | null;
}

type IncomeMode = "ytd" | "total";

function App() {
  const [incomeMode, setIncomeMode] = useState<IncomeMode>("ytd");
  const [incomeSoFar, setIncomeSoFar] = useState("");
  const [taxWithheldSoFar, setTaxWithheldSoFar] = useState("");
  const [bonus, setBonus] = useState("");
  const [rsuData, setRsuData] = useState<RSURelease[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Map<string, number>>(
    new Map(),
  );
  const [ratesLoading, setRatesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/data/f11.1-data.csv")
      .then((r) => r.text())
      .then((text) => {
        setExchangeRates(parseExchangeRatesCSV(text));
        setRatesLoading(false);
      })
      .catch((err) => {
        setError(`Failed to load exchange rates: ${err.message}`);
        setRatesLoading(false);
      });
  }, []);

  function handleRSUUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const releases = parseRSUCSV(text);
      if (releases.length === 0) {
        setError(
          "No RSU release data found in that file. Please upload a Shareworks RSU Releases CSV.",
        );
        return;
      }
      setError(null);
      setRsuData(releases);
    });
  }

  const incomeNum = parseFloat(incomeSoFar) || 0;
  const withheldNum = parseFloat(taxWithheldSoFar) || 0;
  const bonusNum = parseFloat(bonus) || 0;

  const isYTD = incomeMode === "ytd";

  const elapsed = daysElapsedInFY();
  const remaining = TOTAL_FY_DAYS - elapsed;
  const projectionFactor = TOTAL_FY_DAYS / elapsed;

  const annualEmploymentIncome = isYTD
    ? incomeNum * projectionFactor
    : incomeNum;
  const annualTaxWithheld = isYTD
    ? withheldNum * projectionFactor
    : withheldNum;
  const projectedRemainingIncome = isYTD
    ? annualEmploymentIncome - incomeNum
    : 0;

  // Estimate what PAYG should roughly be on income-so-far for sanity-checking.
  const annualTaxOnSalary = calculateTaxSummary(annualEmploymentIncome);
  const expectedWithheld = isYTD
    ? annualTaxOnSalary.totalTax / projectionFactor
    : annualTaxOnSalary.totalTax;

  const rsuWithAUD: RSUReleaseWithAUD[] = useMemo(
    () =>
      rsuData.map((rsu) => {
        const rate = lookupExchangeRate(exchangeRates, rsu.releaseDate);
        return {
          ...rsu,
          exchangeRate: rate,
          valueAUD: rate ? rsu.valueUSD / rate : null,
        };
      }),
    [rsuData, exchangeRates],
  );

  const totalRsuUSD = rsuWithAUD.reduce((sum, r) => sum + r.valueUSD, 0);
  const totalRsuAUD = rsuWithAUD.reduce((sum, r) => sum + (r.valueAUD ?? 0), 0);

  const totalTaxableIncome = annualEmploymentIncome + bonusNum + totalRsuAUD;
  const taxSummary = calculateTaxSummary(totalTaxableIncome);

  // Bonus is PAYG — its marginal tax is assumed withheld by the employer,
  // so we exclude it from the "owing" amount.
  const taxExclBonus = calculateTaxSummary(
    annualEmploymentIncome + totalRsuAUD,
  );
  const estimatedBonusPAYG = taxSummary.totalTax - taxExclBonus.totalTax;
  const netTaxOwing =
    taxSummary.totalTax - annualTaxWithheld - estimatedBonusPAYG;

  if (ratesLoading)
    return <div className="loading">Loading exchange rates…</div>;
  if (error && rsuData.length === 0)
    return <div className="error">{error}</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>🇦🇺 Australian Tax Calculator</h1>
        <p className="subtitle">FY2026 · 1 July 2025 – 30 June 2026</p>
      </header>

      {/* ── Income inputs ── */}
      <section className="card">
        <h2>Employment Income</h2>

        <div className="tab-switcher">
          <button
            className={`tab ${isYTD ? "active" : ""}`}
            onClick={() => setIncomeMode("ytd")}
          >
            Year to Date
          </button>
          <button
            className={`tab ${!isYTD ? "active" : ""}`}
            onClick={() => setIncomeMode("total")}
          >
            Full Year Total
          </button>
        </div>

        <details className="instructions">
          <summary>Where to find these values</summary>
          <ol>
            <li>
              Log in to <strong>myGov</strong> and go to the{" "}
              <strong>ATO</strong> linked service.
            </li>
            <li>
              Navigate to <strong>Employment → Income statements</strong>.
            </li>
            <li>
              Select the <strong>2025–26</strong> financial year.
            </li>
            <li>
              Enter the <strong>Income</strong> column total below as
              "{isYTD ? "Employment Income So Far" : "Total Employment Income"}"
              and the <strong>Tax</strong> column total as
              "{isYTD ? "Tax Withheld So Far" : "Total Tax Withheld"}".
            </li>
          </ol>
        </details>
        <p className="note">
          {isYTD ? (
            <>
              Enter your employment income and PAYG tax withheld{" "}
              <strong>so far</strong> this financial year (
              <strong>excluding</strong> RSU/share income). The app projects your
              totals to 30 June assuming you continue earning at the same rate.
            </>
          ) : (
            <>
              Enter your <strong>total</strong> employment income and PAYG tax
              withheld for the full financial year (
              <strong>excluding</strong> RSU/share income). No projection is
              applied.
            </>
          )}
        </p>
        <div className="input-grid">
          <label>
            <span>
              {isYTD
                ? "Employment Income So Far (AUD)"
                : "Total Employment Income (AUD)"}
            </span>
            <div className="input-wrap">
              <span className="prefix">$</span>
              <input
                type="number"
                value={incomeSoFar}
                onChange={(e) => setIncomeSoFar(e.target.value)}
                placeholder={isYTD ? "110,000" : "150,000"}
                min="0"
              />
            </div>
          </label>
          <label>
            <span>
              {isYTD ? "Tax Withheld So Far (PAYG)" : "Total Tax Withheld (PAYG)"}
            </span>
            <div className="input-wrap">
              <span className="prefix">$</span>
              <input
                type="number"
                value={taxWithheldSoFar}
                onChange={(e) => setTaxWithheldSoFar(e.target.value)}
                placeholder={isYTD ? "33,000" : "45,000"}
                min="0"
              />
            </div>
            {incomeNum > 0 && (
              <span className="field-hint">
                Expected ≈ {formatAUD(expectedWithheld)} based on{" "}
                {formatAUD(incomeNum)} income
                {isYTD ? ` over ${elapsed} days` : " for the full year"}
              </span>
            )}
          </label>
          <label>
            <span>Expected Bonus (AUD)</span>
            <div className="input-wrap">
              <span className="prefix">$</span>
              <input
                type="number"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
                placeholder="20,000"
                min="0"
              />
            </div>
            <span className="field-hint">PAYG withheld by employer</span>
          </label>
        </div>
        {isYTD && (
          <div className="projection-info">
            <span>
              📅 Day <strong>{elapsed}</strong> of {TOTAL_FY_DAYS} in FY2026 (
              {remaining} days remaining) · Projection factor:{" "}
              <strong>×{projectionFactor.toFixed(3)}</strong>
            </span>
          </div>
        )}
      </section>

      {/* ── RSU upload + table ── */}
      <section className="card">
        <h2>RSU Releases</h2>
        <details className="instructions">
          <summary>How to export from Shareworks</summary>
          <ol>
            <li>
              Go to{" "}
              <strong>Shareworks → Activity → Reports → Account Report</strong>
            </li>
            <li>
              Set the following options:
              <ul>
                <li>
                  <strong>Reporting period:</strong> Current fiscal year
                </li>
                <li>
                  <strong>Show sales by lot:</strong> Unchecked
                </li>
                <li>
                  <strong>Display currency:</strong> Minimal currency conversion
                </li>
                <li>
                  <strong>Currency as at date:</strong> Any value
                </li>
                <li>
                  <strong>Output format:</strong> CSV
                </li>
              </ul>
            </li>
            <li>
              Generate the report, then upload the{" "}
              <strong>RSU Releases.csv</strong> file below.
            </li>
          </ol>
        </details>
        <p className="note">
          Values are converted from USD → AUD using the RBA daily exchange rate
          on each vesting date (per ATO guidelines). The rate shown is{" "}
          <em>A$1 = X USD</em>; conversion is <code>AUD = USD ÷ rate</code>.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleRSUUpload}
          hidden
        />
        <button
          type="button"
          className="file-upload-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          {rsuData.length > 0 ? "↻ Replace CSV" : "📂 Upload Shareworks CSV"}
        </button>

        {error && <p className="upload-error">{error}</p>}

        {rsuData.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Release Date</th>
                  <th>Grant</th>
                  <th className="num">Shares</th>
                  <th className="num">FMV / Share</th>
                  <th className="num">Value (USD)</th>
                  <th className="num">AUD/USD Rate</th>
                  <th className="num">Value (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {rsuWithAUD.map((rsu, i) => (
                  <tr key={i}>
                    <td>{rsu.releaseDateStr}</td>
                    <td className="grant-name">{rsu.grantName}</td>
                    <td className="num">{rsu.sharesVested}</td>
                    <td className="num">{formatUSD(rsu.fmvPerShareUSD)}</td>
                    <td className="num">{formatUSD(rsu.valueUSD)}</td>
                    <td className="num">
                      {rsu.exchangeRate?.toFixed(4) ?? "N/A"}
                    </td>
                    <td className="num">
                      {rsu.valueAUD != null ? formatAUD(rsu.valueAUD) : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="num">
                    <strong>Total</strong>
                  </td>
                  <td className="num">
                    <strong>{formatUSD(totalRsuUSD)}</strong>
                  </td>
                  <td></td>
                  <td className="num">
                    <strong>{formatAUD(totalRsuAUD)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ── Income summary ── */}
      <section className="card">
        <h2>{isYTD ? "Projected Income Summary" : "Income Summary"}</h2>
        <div className="summary-table">
          {isYTD ? (
            <>
              <div className="row">
                <span>Employment income so far</span>
                <span>{formatAUD(incomeNum)}</span>
              </div>
              <div className="row">
                <span>
                  Projected remaining income{" "}
                  <span className="muted">({remaining} days)</span>
                </span>
                <span>{formatAUD(projectedRemainingIncome)}</span>
              </div>
            </>
          ) : (
            <div className="row">
              <span>Employment income</span>
              <span>{formatAUD(incomeNum)}</span>
            </div>
          )}
          {bonusNum > 0 && (
            <div className="row">
              <span>
                Bonus{" "}
                <span className="muted">(PAYG – not included in owing)</span>
              </span>
              <span>{formatAUD(bonusNum)}</span>
            </div>
          )}
          <div className="row">
            <span>RSU income (actual, converted to AUD)</span>
            <span>{formatAUD(totalRsuAUD)}</span>
          </div>
          <div className="row total">
            <span>
              {isYTD
                ? "Total Projected Taxable Income"
                : "Total Taxable Income"}
            </span>
            <span>{formatAUD(totalTaxableIncome)}</span>
          </div>
        </div>
      </section>

      {/* ── Tax brackets breakdown ── */}
      <section className="card">
        <h2>Tax Calculation</h2>
        <p className="note">
          FY2026 resident individual rates. Your total taxable income is applied
          progressively through each bracket.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bracket</th>
                <th className="num">Marginal Rate</th>
                <th className="num">Taxable Amount</th>
                <th className="num">Tax in Bracket</th>
              </tr>
            </thead>
            <tbody>
              {taxSummary.brackets.map((b, i) => (
                <tr key={i} className={b.taxableAmount > 0 ? "" : "inactive"}>
                  <td>{b.label}</td>
                  <td className="num">{formatPct(b.rate)}</td>
                  <td className="num">{formatAUD(b.taxableAmount)}</td>
                  <td className="num">{formatAUD(b.taxAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="summary-table tax-totals">
          <div className="row">
            <span>Income Tax</span>
            <span>{formatAUD(taxSummary.incomeTax)}</span>
          </div>
          <div className="row">
            <span>Medicare Levy ({formatPct(MEDICARE_LEVY_RATE)})</span>
            <span>{formatAUD(taxSummary.medicareLevy)}</span>
          </div>
          <div className="row total">
            <span>Total Tax Liability</span>
            <span>{formatAUD(taxSummary.totalTax)}</span>
          </div>
          <div className="row">
            <span>Effective Tax Rate</span>
            <span>{formatPct(taxSummary.effectiveRate)}</span>
          </div>
          {(withheldNum > 0 || bonusNum > 0) && (
            <>
              {withheldNum > 0 && (
                <div className="row">
                  <span>
                    {isYTD ? "Projected salary PAYG" : "Salary PAYG withheld"}{" "}
                    {isYTD && (
                      <span className="muted">
                        ({formatAUD(withheldNum)} ×{" "}
                        {projectionFactor.toFixed(3)})
                      </span>
                    )}
                  </span>
                  <span>− {formatAUD(annualTaxWithheld)}</span>
                </div>
              )}
              {bonusNum > 0 && (
                <div className="row">
                  <span>
                    Estimated bonus PAYG{" "}
                    <span className="muted">(marginal tax on bonus)</span>
                  </span>
                  <span>− {formatAUD(estimatedBonusPAYG)}</span>
                </div>
              )}
              <div
                className={`row total ${netTaxOwing >= 0 ? "owing" : "refund"}`}
              >
                <span>
                  {netTaxOwing >= 0
                    ? "Estimated Tax Owing"
                    : "Estimated Refund"}
                </span>
                <span>{formatAUD(Math.abs(netTaxOwing))}</span>
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="app-footer">
        <p>
          Estimates only — does not include LITO, SAPTO, HELP/HECS repayments,
          or other tax offsets. No CGT is calculated (foreign resident for CGT
          purposes). Exchange rates sourced from the Reserve Bank of Australia
          (Statistical Table F11.1).
        </p>
      </footer>
    </div>
  );
}

export default App;
