"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      const response = await fetch("/api/drops/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await response.json();
      setBusy(false);
      if (!response.ok) {
        setError(json.error ?? "The drop dates could not be imported.");
        return;
      }
      const untracked = json.untrackedSkus?.length
        ? ` Untracked TCINs: ${json.untrackedSkus.join(", ")}.`
        : "";
      setResult(`${json.imported} drop dates imported. ${json.duplicatesIgnored} duplicate alerts ignored.${untracked}`);
      setText("");
      router.refresh();
    } catch {
      setBusy(false);
      setError("The import request failed.");
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
