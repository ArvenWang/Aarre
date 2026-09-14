import { Children, Fragment, isValidElement, useRef, type ComponentProps, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Select as HeroSelect } from "@heroui/react/select";
import { ListBox } from "@heroui/react/list-box";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { FloatingScrollbars } from "./scroll-area";
interface SelectProps { children: ReactNode; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; disabled?: boolean; name?: string; required?: boolean }
interface SelectTriggerProps extends HTMLAttributes<HTMLButtonElement> { icon?: IconComponent; placeholder?: string; error?: string; variant?: "bordered" | "borderless" }
interface SelectContentProps { children: ReactNode; className?: string }
interface SelectItemProps extends HTMLAttributes<HTMLDivElement> { icon?: IconComponent; index: number; value: string; disabled?: boolean }
// These declarations are read by Select to produce one complete HeroUI compound component.
export function SelectTrigger(_props: SelectTriggerProps) { return null; }
export function SelectContent(_props: SelectContentProps) { return null; }
export function SelectItem(_props: SelectItemProps) { return null; }
export function SelectGroup(_props: HTMLAttributes<HTMLDivElement>) { return null; }
export function SelectLabel(_props: HTMLAttributes<HTMLDivElement>) { return null; }
export function SelectSeparator(_props: HTMLAttributes<HTMLDivElement>) { return null; }
function elements(children: ReactNode): ReactElement<Record<string, any>>[] {
  return Children.toArray(children).flatMap((child) => isValidElement(child) ? child.type === Fragment ? elements((child.props as { children: ReactNode }).children) : [child as ReactElement<Record<string, any>>] : []);
}
function options(children: ReactNode): ReactElement<SelectItemProps>[] {
  return elements(children).flatMap((child) => child.type === SelectItem ? [child as ReactElement<SelectItemProps>] : child.props.children ? options(child.props.children) : []);
}
export function Select({ children, value, defaultValue, onValueChange, disabled, name, required }: SelectProps) {
  const parts = elements(children);
  const trigger = parts.find((part) => part.type === SelectTrigger)?.props as SelectTriggerProps | undefined;
  const content = parts.find((part) => part.type === SelectContent)?.props as SelectContentProps | undefined;
  const { icon: Icon, placeholder = "请选择", error, variant, className, ...triggerProps } = trigger || {};
  const items = options(content?.children);
  return <HeroSelect value={value || null} defaultValue={defaultValue} onChange={(key) => onValueChange?.(String(key ?? ""))}
    isDisabled={disabled} isRequired={required} isInvalid={Boolean(error)} name={name}
    placeholder={placeholder} aria-label={triggerProps["aria-label"] || placeholder} className="aarre-select">
    <HeroSelect.Trigger {...(triggerProps as ComponentProps<typeof HeroSelect.Trigger>)} className={cn("aarre-select-trigger", variant === "borderless" && "aarre-select-borderless", className)}>
      {Icon && <Icon size={16} aria-hidden="true" />}<HeroSelect.Value /><HeroSelect.Indicator />
    </HeroSelect.Trigger>
    <SelectPopover className={cn("aarre-select-popover", content?.className)}>
      <ListBox aria-label={triggerProps["aria-label"] || placeholder}>
        {items.map(({ props }) => <ListBox.Item key={props.value} id={props.value} textValue={typeof props.children === "string" ? props.children : props.value}
          isDisabled={props.disabled} className={cn("aarre-select-item", props.className)}>
          {props.icon && <props.icon size={16} aria-hidden="true" />}<span>{props.children}</span><ListBox.ItemIndicator />
        </ListBox.Item>)}
      </ListBox>
    </SelectPopover>
  </HeroSelect>;
}
// This component mounts with the portal, so the scrollbar observes a live viewport.
function SelectPopover({ children, className }: { children: ReactNode; className: string }) {
  return <HeroSelect.Popover data-elevation="popover" className={className} offset={6}>
    <SelectViewport>{children}</SelectViewport>
  </HeroSelect.Popover>;
}
function SelectViewport({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  return <div className="aarre-select-viewport" ref={viewportRef}>{children}<FloatingScrollbars viewportRef={viewportRef} label="选项" /></div>;
}
export type { SelectProps, SelectTriggerProps, SelectContentProps, SelectItemProps };
