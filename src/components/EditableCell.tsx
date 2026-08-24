"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Click the value, type, press Enter or click away to save. Escape cancels.
 * Reverts to the old value if the save is rejected.
 *
 * With readOnly, renders the value as plain text — no hover target, no click.
 * Viewers (MEMBER role) get this; editors (ADMIN) get the interactive version.
 */
export default function EditableCell({
  value,
  onSave,
  mono = false,
  money = false,
  readOnly = false,
  placeholder = "—",
}: {
  value: string | number | null;
  onSave: (v: string | number | null) => Promise<boolean> | boolean;
  mono?: boolean;
  money?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  async function commit() {
    setEditing(false);
    const original = value == null ? "" : String(value);
    if (draft.trim() === original) return;

    const next = money ? (draft.trim() === "" ? null : Number(draft)) : draft.trim();
    const ok = await onSave(next);
    if (!ok) setDraft(original);
  }

  const display =
    value == null || value === ""
      ? placeholder
      : money
        ? `$${Number(value).toFixed(2)}`
        : String(value);

  if (readOnly) {
    return <span className={mono ? "num" : undefined}>{display}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`cell-input ${mono ? "num" : ""}`}
        type={money ? "number" : "text"}
        step={money ? "0.01" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value == null ? "" : String(value));
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      className={`cell-view ${mono ? "num" : ""} ${value == null ? "muted" : ""}`}
      onClick={() => setEditing(true)}
    >
      {display}
    </button>
  );
}