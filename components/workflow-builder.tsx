"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { saveWorkflow, type StepInput, type TriggerInput } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import {
  STEP_META,
  STEP_ORDER,
  TRIGGER_META,
  defaultConfigFor,
} from "@/lib/step-meta"
import type { Role, StepType, TriggerType } from "@/lib/types"
import { cn } from "@/lib/utils"

interface DraftStep extends StepInput {
  key: string
}

interface WorkflowBuilderProps {
  role: Role
  initial?: {
    id: string
    name: string
    steps: { type: StepType; name: string; config: Record<string, unknown>; order: number }[]
    triggers: { type: TriggerType; config: Record<string, unknown> }[]
  }
}

let keyCounter = 0
const nextKey = () => `k${keyCounter++}`

export function WorkflowBuilder({ role, initial }: WorkflowBuilderProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(initial?.name ?? "Untitled workflow")
  const [steps, setSteps] = useState<DraftStep[]>(
    initial?.steps.map((s) => ({ ...s, key: nextKey() })) ??
      [
        { key: nextKey(), type: "llm_call", name: STEP_META.llm_call.label, config: defaultConfigFor("llm_call"), order: 0 },
      ],
  )
  const [triggers, setTriggers] = useState<TriggerInput[]>(
    initial?.triggers ?? [{ type: "manual", config: {} }],
  )

  const isOwner = role === "owner"

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setSteps((prev) => {
      const oldIndex = prev.findIndex((s) => s.key === active.id)
      const newIndex = prev.findIndex((s) => s.key === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function addStep(type: StepType) {
    setSteps((prev) => [
      ...prev,
      { key: nextKey(), type, name: STEP_META[type].label, config: defaultConfigFor(type), order: prev.length },
    ])
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key))
  }

  function patchStep(key: string, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function patchConfig(key: string, cfg: Record<string, unknown>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, config: { ...s.config, ...cfg } } : s)))
  }

  function toggleTrigger(type: TriggerType) {
    setTriggers((prev) => {
      const exists = prev.some((t) => t.type === type)
      if (exists) return prev.filter((t) => t.type !== type)
      return [...prev, { type, config: {} }]
    })
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await saveWorkflow({
        workflowId: initial?.id,
        name,
        steps: steps.map((s, i) => ({ type: s.type, name: s.name, config: s.config, order: i })),
        triggers,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/workflows/${res.workflowId}`)
      router.refresh()
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Workflow name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-lg font-medium outline-none focus:border-primary/60"
          />
        </div>

        <div>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Steps ({steps.length}) · drag to reorder
          </h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {steps.map((s, i) => (
                  <SortableStep
                    key={s.key}
                    step={s}
                    index={i}
                    onRemove={() => removeStep(s.key)}
                    onPatch={(p) => patchStep(s.key, p)}
                    onPatchConfig={(c) => patchConfig(s.key, c)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {steps.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Add a step to begin.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={pending || steps.length === 0}>
            {pending ? "Saving…" : initial ? "Save changes" : "Create workflow"}
          </Button>
          <Button variant="ghost" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Add step
          </h2>
          <div className="flex flex-col gap-1.5">
            {STEP_ORDER.map((type) => {
              const meta = STEP_META[type]
              const locked = meta.ownerOnly && !isOwner
              return (
                <button
                  key={type}
                  onClick={() => addStep(type)}
                  disabled={locked}
                  title={locked ? "Only an owner can add this step" : meta.description}
                  className={cn(
                    "flex items-center justify-between rounded-lg border border-border bg-background px-2.5 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent/40",
                    locked && "cursor-not-allowed opacity-45 hover:border-border hover:bg-background",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("font-mono text-[0.7rem] font-semibold", meta.accent)}>
                      {meta.short}
                    </span>
                    <span>{meta.label}</span>
                  </span>
                  {locked ? (
                    <span className="font-mono text-[0.65rem] text-muted-foreground">owner</span>
                  ) : (
                    <Plus className="size-3.5 text-muted-foreground" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Triggers
          </h2>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(TRIGGER_META) as TriggerType[]).map((type) => {
              const meta = TRIGGER_META[type]
              const locked = meta.ownerOnly && !isOwner
              const active = triggers.some((t) => t.type === type)
              return (
                <button
                  key={type}
                  onClick={() => toggleTrigger(type)}
                  disabled={locked}
                  title={locked ? "Only an owner can add this trigger" : meta.description}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background hover:border-primary/40",
                    locked && "cursor-not-allowed opacity-45",
                  )}
                >
                  <span>{meta.label}</span>
                  {locked ? (
                    <span className="font-mono text-[0.65rem] text-muted-foreground">owner</span>
                  ) : (
                    <span
                      className={cn(
                        "size-4 rounded border border-border",
                        active && "border-primary bg-primary",
                      )}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SortableStep({
  step,
  index,
  onRemove,
  onPatch,
  onPatchConfig,
}: {
  step: DraftStep
  index: number
  onRemove: () => void
  onPatch: (p: Partial<DraftStep>) => void
  onPatchConfig: (c: Record<string, unknown>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.key,
  })
  const meta = STEP_META[step.type]

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-border bg-card p-3",
        isDragging && "border-primary/60 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </button>
        <span className="grid size-6 place-items-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
          {index + 1}
        </span>
        <span className={cn("font-mono text-[0.7rem] font-semibold", meta.accent)}>{meta.short}</span>
        <input
          value={step.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-primary/60"
        />
        <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label="Remove step">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <StepConfig type={step.type} config={step.config} onChange={onPatchConfig} />
      </div>
    </div>
  )
}

function StepConfig({
  type,
  config,
  onChange,
}: {
  type: StepType
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary/60 font-mono"
  const label = "mb-1 block font-mono text-[0.7rem] uppercase tracking-wide text-muted-foreground"

  switch (type) {
    case "llm_call":
      return (
        <div className="space-y-2">
          <div>
            <span className={label}>Prompt</span>
            <textarea
              rows={3}
              value={String(config.prompt ?? "")}
              onChange={(e) => onChange({ prompt: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>Model</span>
            <input
              value={String(config.model ?? "")}
              onChange={(e) => onChange({ model: e.target.value })}
              className={field}
            />
          </div>
        </div>
      )
    case "http_request":
      return (
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <div>
            <span className={label}>Method</span>
            <input
              value={String(config.method ?? "GET")}
              onChange={(e) => onChange({ method: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>URL</span>
            <input
              value={String(config.url ?? "")}
              onChange={(e) => onChange({ url: e.target.value })}
              className={field}
            />
          </div>
        </div>
      )
    case "conditional_branch":
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className={label}>If output contains</span>
            <input
              value={String(config.contains ?? "")}
              onChange={(e) => onChange({ contains: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>Else skip N steps</span>
            <input
              type="number"
              min={0}
              value={Number(config.skipCount ?? 1)}
              onChange={(e) => onChange({ skipCount: Number(e.target.value) })}
              className={field}
            />
          </div>
        </div>
      )
    case "notify":
      return (
        <div className="grid grid-cols-[110px_1fr] gap-2">
          <div>
            <span className={label}>Channel</span>
            <input
              value={String(config.channel ?? "")}
              onChange={(e) => onChange({ channel: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <span className={label}>Message</span>
            <input
              value={String(config.message ?? "")}
              onChange={(e) => onChange({ message: e.target.value })}
              className={field}
            />
          </div>
        </div>
      )
    case "approval_gate":
      return (
        <div>
          <span className={label}>Note</span>
          <input
            value={String(config.note ?? "")}
            onChange={(e) => onChange({ note: e.target.value })}
            className={field}
          />
        </div>
      )
    case "db_write":
      return (
        <p className="font-mono text-xs text-muted-foreground">
          Persists the previous step&apos;s output to your org&apos;s artifacts table.
        </p>
      )
    default:
      return null
  }
}
