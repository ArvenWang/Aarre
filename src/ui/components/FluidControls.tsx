import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { cn } from "@/lib/utils";

const controlClassName =
  "fluid-control w-full border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--accent)] focus:bg-[color:var(--surface)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]";

const FluidInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(controlClassName, "fluid-input", className)}
      {...props}
    />
  )
);

FluidInput.displayName = "FluidInput";

const FluidTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlClassName, "fluid-textarea", className)}
    {...props}
  />
));

FluidTextarea.displayName = "FluidTextarea";

const FluidSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(controlClassName, "fluid-select", className)}
    {...props}
  />
));

FluidSelect.displayName = "FluidSelect";

export { FluidInput, FluidTextarea, FluidSelect };
