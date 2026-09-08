"use client";

import { useEffect, useRef, useState } from "react";
import { deletePreset, importPreset, listPresets, MAX_PRESET_BYTES, PRESET_PREFIX, savePreset, type MatchupPreset } from "./presets";

export function MatchupPresets({ configuration, onLoad }: { configuration: Pick<MatchupPreset, "opponents" | "seed" | "roundMode">; onLoad: (preset: MatchupPreset) => void }) {
  const [presets, setPresets] = useState<MatchupPreset[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const fileRequest = useRef(0);
  function refresh() { setPresets(listPresets(window.localStorage)); }
  useEffect(() => {
    const update = () => { try { setPresets(listPresets(window.localStorage)); } catch { setMessage("Preset storage is unavailable. Your live run is unchanged."); } };
    update();
    const changed = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(PRESET_PREFIX)) update(); };
    window.addEventListener("storage", changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate asynchronous file reads, not a DOM ref
    return () => { fileRequest.current++; window.removeEventListener("storage", changed); };
  }, []);
  function save() {
    try { savePreset(window.localStorage, { ...configuration, version: 1, id: crypto.randomUUID(), name }); refresh(); setMessage("Preset saved on this device. Live totals were not included."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Preset could not be saved."); }
  }
  function load(preset: MatchupPreset) {
    fileRequest.current++;
    try {
      const latest = importPreset(window.localStorage.getItem(`${PRESET_PREFIX}${preset.id}`) ?? "");
      if (!latest || latest.id !== preset.id) throw new Error("This preset is no longer available. Your run is unchanged.");
      onLoad(latest); setMessage("Preset loaded into setup only. Choose Start new run when ready."); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preset could not be loaded."); }
  }
  function remove(preset: MatchupPreset) {
    try { deletePreset(window.localStorage, preset); refresh(); setMessage(`Deleted preset “${preset.name}” from this device. The live run is unchanged.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Preset could not be deleted."); try { refresh(); } catch { /* Keep the last visible list if storage is unavailable. */ } }
  }
  function download(preset: MatchupPreset) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "betafish-matchup.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const request = ++fileRequest.current;
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_PRESET_BYTES) throw new Error("Choose a preset file smaller than 16 KiB.");
      const imported = importPreset(await file.text());
      if (request !== fileRequest.current) return;
      if (!imported) throw new Error("This preset file is invalid or requires a newer app.");
      onLoad(imported); setName(imported.name); setMessage("Imported into setup only. Save a named copy or start a new run when ready.");
    } catch (error) { if (request === fileRequest.current) setMessage(error instanceof Error ? error.message : "Preset file could not be read."); }
  }
  return <section className="matchup-presets" aria-labelledby="presets-title"><h3 id="presets-title">Matchup presets</h3><p>Device-local configurations, without live totals, clocks or history. Loading and importing only change the new-run draft.</p><label>Preset name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><button className="secondary-button" type="button" onClick={save}>Save matchup preset</button><label>Import matchup preset<input type="file" accept=".json,application/json" onChange={importFile} /></label><ul>{presets.map((preset) => <li key={preset.id}><strong>{preset.name}</strong><small>{preset.opponents.length} opponents · {preset.roundMode === "table" ? "seat-by-seat" : "quick"} · {preset.seed}</small><div><button type="button" onClick={() => load(preset)} aria-label={`Load ${preset.name}`}>Load</button><button type="button" onClick={() => download(preset)} aria-label={`Export ${preset.name}`}>Export</button><button type="button" onClick={() => remove(preset)} aria-label={`Delete ${preset.name}`}>Delete</button></div></li>)}</ul>{message && <p role="status">{message}</p>}</section>;
}
