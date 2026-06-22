import { memo } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';

import { Codicon } from './Codicon';

export type PickerProps<T> = {
  label: string;
  title: string;
  icon: string;
  currentValue: string | null;
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  itemDescription: (item: T) => string | undefined;
  isOpen: boolean;
  onToggle: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelect: (item: T, event: ReactMouseEvent<HTMLDivElement>) => void;
};

function PickerComponent<T>({
  label,
  title,
  icon,
  currentValue,
  items,
  itemKey,
  itemLabel,
  itemDescription,
  isOpen,
  onToggle,
  onSelect,
}: PickerProps<T>): JSX.Element {
  return (
    <div className="picker-wrap" onClick={(event) => event.stopPropagation()}>
      <button className="picker-btn" title={title} type="button" onClick={onToggle}>
        <Codicon className="picker-icon" name={icon} />
        <span className="picker-label">{label}</span>
        <Codicon className="picker-chevron" name="chevron-down" />
      </button>
      <div className={`picker-dropdown${isOpen ? ' open' : ''}`}>
        {items.map((item) => {
          const key = itemKey(item);
          const selected = key === currentValue;
          const description = itemDescription(item);
          return (
            <div
              className={`picker-dropdown-item${selected ? ' selected' : ''}`}
              key={key}
              onClick={(event) => onSelect(item, event)}
            >
              <span className="check">{selected ? <Codicon name="check" /> : null}</span>
              <span className="item-label">{itemLabel(item)}</span>
              {description ? <span className="item-desc">{description}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const Picker = memo(PickerComponent) as typeof PickerComponent;
