"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_IMPORT_CHARS = 300_000;

function splitImportText(value: string) {
  if (value.length <= MAX_IMPORT_CHARS) return [value];

  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + MAX_IMPORT_CHARS, value.length);
    if (end < value.length) {
      const messageBoundary = value.lastIndexOf("\n[", end);
      if (messageBoundary > start) end = messageBoundary + 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export default function ImportDrops({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setText(await file.text());
      setResult(`Loaded ${file.name}.`);
    } catch {
      setError("That text export could not be read.");
    }
  }

  async function importDrops() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const chunks = splitImportText(text);
      let imported = 0;
      let duplicatesIgnored = 0;
      const untrackedSkus = new Set<string>();

      for (let index = 0; index < chunks.length; index += 1) {
        if (chunks.length > 1) setResult(`Importing batch ${index + 1} of ${chunks.length}…`);
        const response = await fetch("/api/drops/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunks[index] }),
        });
        const responseText = await response.text();
        let json: {
          error?: string;
          imported?: number;
          duplicatesIgnored?: number;
          untrackedSkus?: string[];
        } = {};
        try {
          json = responseText ? JSON.parse(responseText) : {};
        } catch {
          // Proxies commonly return an HTML page for request-size and gateway errors.
        }
        if (!response.ok) {
          throw new Error(json.error ?? `Import batch ${index + 1} failed (HTTP ${response.status}).`);
        }
        imported += json.imported ?? 0;
        duplicatesIgnored += json.duplicatesIgnored ?? 0;
        json.untrackedSkus?.forEach((sku) => untrackedSkus.add(sku));
      }

      setBusy(false);
      const untracked = untrackedSkus.size
        ? ` Untracked TCINs: ${[...untrackedSkus].join(", ")}.`
        : "";
      setResult(`${imported} drop dates imported. ${duplicatesIgnored} duplicate alerts ignored.${untracked}`);
      setText("");
      router.refresh();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "The import request failed.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal drop-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Import drop dates</h2>
            <p className="muted">Paste copied Target restock alerts. Each TCIN counts once per day.</p>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>
        <textarea
          className="drop-import-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste Zephyr Target restock alerts here…"
          rows={12}
        />
        <div className="drop-import-actions">
          <label className="ghost-btn drop-file-button">
            Choose Discord export
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </label>
          <button className="primary-btn" onClick={importDrops} disabled={busy || !text.trim()}>
            {busy ? "Importing…" : "Import dates"}
          </button>
        </div>
        {result && <p className="drop-import-result">{result}</p>}
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      </div>
    </div>
  );
}
