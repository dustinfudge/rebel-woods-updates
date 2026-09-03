"use client";

import { ArrowLeft, Check, GripVertical, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

interface HerdBoardHerd {
  readonly fieldId: string | null;
  readonly id: string;
}

interface HerdBoardField {
  readonly id: string;
  readonly name: string;
}

interface HerdBoardHorse {
  readonly herdId: string | null;
  readonly id: string;
  readonly name: string;
  readonly thumbnailUrl: string | null;
}

interface HerdColumn {
  readonly fieldId: string | null;
  readonly herdId: string | null;
  readonly title: string;
}

interface HerdBoardProps {
  readonly fields: readonly HerdBoardField[];
  readonly herds: readonly HerdBoardHerd[];
  readonly horses: readonly HerdBoardHorse[];
  readonly onBack: () => void;
  readonly onMoveHerdField: (herdId: string, fieldId: string | null) => Promise<boolean>;
  readonly onMoveHorse: (horseId: string, herdId: string | null) => Promise<boolean>;
}

const unassignedColumnId = "unassigned";

export function HerdBoard({ fields, herds, horses, onBack, onMoveHerdField, onMoveHorse }: HerdBoardProps): React.JSX.Element {
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [draggedHorseId, setDraggedHorseId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [savingHorseId, setSavingHorseId] = useState<string | null>(null);
  const [savingHerdId, setSavingHerdId] = useState<string | null>(null);

  const columns = useMemo<readonly HerdColumn[]>(() => [
    { fieldId: null, herdId: null, title: "Not in a herd" },
    ...herds.map((herd, index) => ({ fieldId: herd.fieldId, herdId: herd.id, title: `Herd ${index + 1}` })),
  ], [herds]);

  const selectedHorse = horses.find((horse) => horse.id === selectedHorseId) ?? null;

  async function moveHorse(horseId: string, destinationHerdId: string | null): Promise<void> {
    const horse = horses.find((candidate) => candidate.id === horseId);
    if (!horse || horse.herdId === destinationHerdId || savingHorseId) {
      setSelectedHorseId(null);
      return;
    }
    setSavingHorseId(horseId);
    const wasMoved = await onMoveHorse(horseId, destinationHerdId);
    setSavingHorseId(null);
    if (wasMoved) setSelectedHorseId(null);
  }

  function columnIdentifier(herdId: string | null): string {
    return herdId ?? unassignedColumnId;
  }

  async function moveHerdField(herdId: string, fieldId: string | null): Promise<void> {
    setSavingHerdId(herdId);
    await onMoveHerdField(herdId, fieldId);
    setSavingHerdId(null);
  }

  return <section>
    <button className="mb-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#cfd4ce] bg-white px-4 py-2 text-sm font-bold text-[#385943]" onClick={onBack} type="button"><ArrowLeft size={16} />Back to horses</button>
    <div className="mb-5 rounded-[2rem] bg-[#1d3528] p-6 text-white shadow-xl sm:p-8">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#d9a27b]">Herd manager</p>
      <h1 className="mb-3 font-serif text-4xl sm:text-5xl">Build your horse groups.</h1>
      <p className="mb-0 max-w-3xl leading-7 text-[#cdd9cf]">Drag a horse into another box. On a phone, tap a horse and then tap <strong>Move here</strong> in the destination herd. Changing a herd’s field moves every horse in that box together.</p>
    </div>

    {selectedHorse ? <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#b8c9bb] bg-[#e4ece4] px-4 py-3 text-sm text-[#1d3528]" role="status"><span><strong>{selectedHorse.name}</strong> selected. Choose a herd below.</span><button className="font-bold underline" onClick={() => setSelectedHorseId(null)} type="button">Cancel</button></div> : null}

    <div className="flex snap-x gap-4 overflow-x-auto pb-5" aria-label="Herd groups">
      {columns.map((column) => {
        const columnId = columnIdentifier(column.herdId);
        const columnHorses = horses.filter((horse) => horse.herdId === column.herdId).sort((left, right) => left.name.localeCompare(right.name));
        const isDropTarget = activeColumnId === columnId;
        const canMoveSelectedHorse = selectedHorse !== null && selectedHorse.herdId !== column.herdId;
        return <section
          className={`min-h-72 w-[82vw] max-w-sm shrink-0 snap-start rounded-3xl border-2 p-4 transition sm:w-80 ${isDropTarget ? "border-[#a65333] bg-[#f3ded3]" : "border-[#cfd4ce] bg-[#fffdf8]"}`}
          key={columnId}
          onDragEnter={(event) => { event.preventDefault(); setActiveColumnId(columnId); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveColumnId(null); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={(event) => {
            event.preventDefault();
            const horseId = event.dataTransfer.getData("text/plain") || draggedHorseId;
            setActiveColumnId(null);
            setDraggedHorseId(null);
            if (horseId) void moveHorse(horseId, column.herdId);
          }}
        >
          <header className="mb-4 border-b border-[#dedfd8] pb-3">
            <div className="flex min-h-12 items-center justify-between gap-3"><span><strong className="block font-serif text-2xl text-[#1d3528]">{column.title}</strong><small className="font-bold text-[#68736b]">{columnHorses.length} {columnHorses.length === 1 ? "horse" : "horses"}</small></span>
            {canMoveSelectedHorse ? <button className="min-h-10 rounded-full bg-[#1d3528] px-4 text-xs font-bold text-white" disabled={savingHorseId !== null} onClick={() => void moveHorse(selectedHorse.id, column.herdId)} type="button">Move here</button> : null}
            </div>
            {column.herdId ? <label className="mt-2 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#68736b]">Field<select aria-label={`${column.title} field`} className="mt-1 min-h-10 w-full rounded-xl border border-[#cfd4ce] bg-white px-3 text-sm font-bold normal-case tracking-normal text-[#385943]" disabled={savingHerdId !== null || columnHorses.length === 0} onChange={(event) => void moveHerdField(column.herdId as string, event.target.value || null)} value={column.fieldId ?? ""}><option value="">No field assigned</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label> : null}
          </header>

          <div className="space-y-2">
            {columnHorses.map((horse) => {
              const isSelected = selectedHorseId === horse.id;
              const isSaving = savingHorseId === horse.id;
              return <button
                aria-pressed={isSelected}
                className={`flex min-h-16 w-full cursor-grab items-center gap-3 rounded-2xl border p-2.5 text-left shadow-sm transition active:cursor-grabbing ${isSelected ? "border-[#1f5f8b] bg-[#e3eff7] ring-2 ring-[#1f5f8b]/20" : "border-[#dedfd8] bg-white hover:border-[#9cad9f]"}`}
                disabled={savingHorseId !== null}
                draggable={!isSaving}
                key={horse.id}
                onClick={() => setSelectedHorseId((currentHorseId) => currentHorseId === horse.id ? null : horse.id)}
                onDragEnd={() => { setDraggedHorseId(null); setActiveColumnId(null); }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", horse.id);
                  setDraggedHorseId(horse.id);
                  setSelectedHorseId(horse.id);
                }}
                type="button"
              >
                {horse.thumbnailUrl ? <Image alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" height={96} src={horse.thumbnailUrl} unoptimized width={96} /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#1d3528] font-serif text-xl text-white">{horse.name.slice(0, 1).toUpperCase()}</span>}
                <strong className="min-w-0 flex-1 truncate text-[#1d3528]">{horse.name}</strong>
                {isSaving ? <LoaderCircle className="animate-spin text-[#385943]" size={18} /> : isSelected ? <Check className="text-[#1f5f8b]" size={18} /> : <GripVertical className="text-[#829087]" size={20} />}
              </button>;
            })}
            {columnHorses.length === 0 ? <div className="grid min-h-40 place-items-center rounded-2xl border-2 border-dashed border-[#cfd4ce] px-5 text-center text-sm font-semibold text-[#68736b]">Drop a horse here</div> : null}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
