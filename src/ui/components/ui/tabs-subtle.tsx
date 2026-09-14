import { Children, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
interface ItemProps extends HTMLAttributes<HTMLButtonElement> { icon?: IconComponent; label: string; index: number }
interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> { children: ReactNode; selectedIndex: number; onSelect: (index: number) => void; equalWidth?: boolean; activeLabel?: boolean; idPrefix?: string }
export function TabsSubtleItem(_props: ItemProps) { return null; }
/** A segmented value picker. Actual page navigation uses HeroUI Tabs with its panels. */
export function TabsSubtle({ children, selectedIndex, onSelect, equalWidth, activeLabel: _active, idPrefix: _prefix, className, ...props }: Props) {
  return <ToggleButtonGroup {...props} selectionMode="single" disallowEmptySelection selectedKeys={new Set([String(selectedIndex)])}
    onSelectionChange={(keys) => { const next = [...keys][0]; if (next !== undefined) onSelect(Number(next)); }}
    className={cn("aarre-segmented", equalWidth && "aarre-segmented-equal", className)}>
    {Children.toArray(children).filter(isValidElement).map((child) => {
      const { icon: Icon, label, index, className: itemClass } = (child as ReactElement<ItemProps>).props;
      return <ToggleButton key={index} id={String(index)} className={cn("aarre-segment", itemClass)}>{Icon && <Icon size={16} aria-hidden="true" />}{label}</ToggleButton>;
    })}
  </ToggleButtonGroup>;
}
export default TabsSubtle;
