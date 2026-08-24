"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/roi";

type Point = { date: string; marketPrice: number | null; retailPrice: number | null };

/**
 * 30-day market price chart for one SKU.
 *
 * Plain SVG rather than a charting library — this is one line and some axis
 * labels, and pulling in a dependency for it would cost more than it's worth.
 */
export default function PriceHistory({
  productId,
  productName,
  cost,
  onClose,
}: {
  productId: string;
  productName: string;
  /** Retail + tax, drawn as a break-even line. */
  cost: number | null;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/products/${productId}/history?days=30`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load history."))))
      .then((data) => { if (!cancelled) setPoints(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [productId]);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const priced = (points ?? []).filter((p) => p.marketPrice != null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{productName}</h2>
            <p className="muted">Market price, last 30 days</p>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {!points && !error && <p className="muted">Loading…</p>}

        {points && priced.length === 0 && (
          <p className="muted">
            No price history yet. A point gets recorded each time prices sync or you edit the market
            value, so the chart fills in from here.
          </p>
        )}

        {priced.length === 1 && (
          <p className="muted">
            One data point so far ({money(priced[0].marketPrice)} on {priced[0].date}). The line
            appears once there are two.
          </p>
        )}

        {priced.length > 1 && <Chart points={priced} cost={cost} />}
      </div>
    </div>
  );
}

function Chart({ points, cost }: { points: Point[]; cost: number | null }) {
  const W = 640, H = 260;
  const pad = { top: 20, right: 16, bottom: 34, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = points.map((p) => p.marketPrice as number);
  const candidates = cost != null ? [...values, cost] : values;
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);

  // Pad the range so a flat line doesn't sit on the axis
  const span = max - min || Math.max(max * 0.1, 1);
  min = Math.max(0, min - span * 0.15);
  max = max + span * 0.15;

  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.marketPrice as number)}`).join(" ");
  const area = `${line} L ${x(points.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`;

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;

  const ticks = [min, (min + max) / 2, max];

  return (
    <>
      <div className="chart-summary">
        <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{money(last)}</span>
        <span className={`num chart-change ${change >= 0 ? "pos" : "neg"}`}>
          {change >= 0 ? "▲" : "▼"} {money(Math.abs(change))} ({changePct.toFixed(1)}%)
        </span>
        <span className="muted" style={{ fontSize: 12 }}>over {points.length} days</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Market price over time">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="axis" textAnchor="end">
              ${t.toFixed(0)}
            </text>
          </g>
        ))}

        {cost != null && cost >= min && cost <= max && (
          <>
            <line x1={pad.left} x2={W - pad.right} y1={y(cost)} y2={y(cost)} className="breakeven" />
            <text x={W - pad.right} y={y(cost) - 6} className="axis breakeven-label" textAnchor="end">
              break even {money(cost)}
            </text>
          </>
        )}

        <path d={area} className="area" />
        <path d={line} className="line" />

        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.marketPrice as number)} r={3} className="dot">
            <title>{`${p.date} — ${money(p.marketPrice)}`}</title>
          </circle>
        ))}

        <text x={pad.left} y={H - 10} className="axis">{points[0].date.slice(5)}</text>
        <text x={W - pad.right} y={H - 10} className="axis" textAnchor="end">
          {points[points.length - 1].date.slice(5)}
        </text>
      </svg>
    </>
  );
}
