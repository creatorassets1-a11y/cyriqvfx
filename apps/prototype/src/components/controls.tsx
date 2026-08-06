import { useId } from 'react';

/**
 * Shared inspector controls.
 *
 * Sliders carry their value as text as well as position: on a phone the thumb
 * covers the track while you drag it, so a number that only lives in the
 * thumb's position is a number you cannot read while setting it.
 */

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Formats the displayed value; defaults to two significant decimals. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  /** Value the double-tap reset returns to. */
  defaultValue?: number;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  onCommit,
  defaultValue = 0,
}: SliderProps) {
  const id = useId();
  const display = format ? format(value) : trim(value);
  const modified = Math.abs(value - defaultValue) > 1e-6;

  return (
    <div className="slider">
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">
          {label}
        </label>
        <button
          type="button"
          className={`slider__value ${modified ? 'is-modified' : ''}`}
          onClick={() => {
            onChange(defaultValue);
            onCommit?.();
          }}
          aria-label={`${label} is ${display}. Activate to reset.`}
        >
          {display}
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segmented__option ${value === option.value ? 'is-on' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="toggle">
      <div className="toggle__text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="toggle__hint">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle__switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  );
}

export function PanelSection({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="panel-section">
      <h3 className="panel-section__title">{title}</h3>
      {note && <p className="panel-section__note">{note}</p>}
      {children}
    </section>
  );
}

/** Marks a control as needing a connection, per the PRD's honest-AI rule. */
export function OnlineBadge({ reason }: { reason?: string }) {
  return (
    <span className="online-badge" title={reason ?? 'Requires internet'}>
      <span className="online-badge__dot" aria-hidden="true" />
      Online
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__body">{body}</p>
    </div>
  );
}

const trim = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
};
