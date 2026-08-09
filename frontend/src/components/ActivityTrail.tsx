export interface ActivityStep {
  label: string;
  state: "done" | "active" | "pending" | "error";
}

const MARK: Record<ActivityStep["state"], string> = {
  done: "✓",
  active: "◉",
  pending: "○",
  error: "✕",
};

const COLOR: Record<ActivityStep["state"], string> = {
  done: "text-signal",
  active: "text-text-primary",
  pending: "text-text-muted",
  error: "text-red-400",
};

export function ActivityTrail({ steps }: { steps: ActivityStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="font-display text-sm space-y-1 border-l border-line pl-4 py-1">
      {steps.map((step, i) => (
        <div key={i} className={`flex items-center gap-2 ${COLOR[step.state]}`}>
          <span>{MARK[step.state]}</span>
          <span className={step.state === "pending" ? "text-text-muted" : ""}>{step.label}</span>
        </div>
      ))}
    </div>
  );
}
