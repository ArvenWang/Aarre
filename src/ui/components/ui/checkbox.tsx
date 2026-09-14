import { Checkbox as HeroCheckbox } from "@heroui/react/checkbox";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
type Props = Omit<ComponentProps<typeof HeroCheckbox>, "onChange" | "isSelected" | "children"> & {
  children?: ReactNode;
  checked?: boolean | "indeterminate"; disabled?: boolean; onCheckedChange?: (value: boolean) => void;
};
export function Checkbox({ checked, disabled, onCheckedChange, className, children, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props }: Props) {
  return <HeroCheckbox {...props} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} isSelected={checked === true} isIndeterminate={checked === "indeterminate"}
    isDisabled={disabled} onChange={onCheckedChange} className={cn("aarre-checkbox", className)}>
    <HeroCheckbox.Content><HeroCheckbox.Control><HeroCheckbox.Indicator /></HeroCheckbox.Control></HeroCheckbox.Content>
    {children}
  </HeroCheckbox>;
}
