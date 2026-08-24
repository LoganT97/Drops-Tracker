"use client";

import { useEffect, useState } from "react";
import { money, pct } from "@/lib/roi";
import { RETAILERS, type RetailerKey } from "@/lib/retailers";
import EditableCell from "./EditableCell";
import type { Row } from "./Dashboard";

type Point = { date: string; marketPrice: number | null; retailPrice: number | null };

/**
 * Everything about one SKU in one card: photo, name, the price breakdown, and
 * 30 days of market history. Opened by clicking the product name.
 */
export default function ProductDetail({
  row,
  retailer,
  canEdit,
  onSave,
  onClose,
}: {
  row: Row;
  retailer: RetailerKey;
  canEdit: boolean;
  onSave: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/products/${row.id}/history?days=30`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load history."))))
      .then((data) => { if (!cancelled) setPoints(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [row.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const priced = (points ?? []).filter((p) => p.marketPrice != null);
  const meta = RETAILERS[retailer];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="detail-title">
            {row.imageUrl && <img className="detail-photo" src={row.imageUrl} alt={row.productName} />}
            <div>
              <h2>
                <EditableCell
                  readOnly={!canEdit || row.linked}
                  value={row.productName}
                  onSave={(v) => onSave(row.id, { productName: v })}
                />
              </h2>
              <p className="muted">
                {row.brand} · {meta.skuLabel} <span className="num">{row.sku}</span>
                {row.linked && <span className="linked-dot" title="Priced from TCGplayer"> ●</span>}
              </p>
              {row.productUrl && (
                <a className="detail-link" href={row.productUrl} target="_blank" rel="noreferrer">
                  Open on {meta.label} ↗
                </a>
              )}
            </div>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>

        <div className="detail-stats">
          <Stat label="Retail" value={money(row.retailPrice)} />
          <Stat label="Retail + tax" value={money(row.cost)} />
          <Stat label="Market value" value={money(row.marketPrice)} />
          <Stat
            label="Profit / box"
            value={money(row.netProfit)}
            tone={(row.netProfit ?? 0) >= 0 ? "pos" : "neg"}
          />
          <Stat label="Potential ROI" value={pct(row.grossRoi)} tone={row.bucket} />
        </div>

        <h3 className="detail-section">Market price, last 30 days</h3>

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {!points && !error && <p className="muted">Loading…</p>}

        {points && priced.length === 0 && (
          <p className="muted">
            No history yet. A point is recorded each time prices sync or the market value is edited,
            so the chart fills in from here.
          </p>
        )}

        {priced.length === 1 && (
          <p className="muted">
            One point so far ({money(priced[0].marketPrice)} on {priced[0].date}). The line appears
            once there are two.
          </p>
        )}

        {priced.length > 1 && <Chart points={priced} cost={row.cost} />}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${tone ? `tone-${tone}` : ""}`}>{value}</div>
    </div>
  );
}

/**
 * Plain SVG rather than a charting library — this is one line and three axis
 * labels, and a dependency would cost more than it saves.
 */
function Chart({ points, cost }: { points: Point[]; cost: number | null }) {
  const W = 640, H = 240;
  const pad = { top: 18, right: 16, bottom: 30, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = points.map((p) => p.marketPrice as number);
  const candidates = cost != null ? [...values, cost] : values;
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);

  const span = max - min || Math.max(max * 0.1, 1);
  min = Math.max(0, min - span * 0.15);
  max = max + span * 0.15;

  const x = (i: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.marketPrice as number)}`)
    .join(" ");
  const area = `${line} L ${x(points.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`;

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;

  return (
    <>
      <div className="chart-summary">
        <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{money(last)}</span>
        <span className={`num chart-change ${change >= 0 ? "pos" : "neg"}`}>
          {change >= 0 ? "▲" : "▼"} {money(Math.abs(change))} ({changePct.toFixed(1)}%)
        </span>
        <span className="muted" style={{ fontSize: 12 }}>over {points.length} days</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Market price over time">
        {[min, (min + max) / 2, max].map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="axis" textAnchor="end">${t.toFixed(0)}</text>
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

        <text x={pad.left} y={H - 8} className="axis">{points[0].date.slice(5)}</text>
        <text x={W - pad.right} y={H - 8} className="axis" textAnchor="end">
          {points[points.length - 1].date.slice(5)}
        </text>
      </svg>
    </>
  );
}
