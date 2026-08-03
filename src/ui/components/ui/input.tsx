import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// Form fields focus by darkening their own border. An accent ring around the
// field reads as a green selection frame and is not used here — that token
// stays for keyboard focus on buttons and other non-field controls.
const controlClassName =
  "fluid-control w-full border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] outline-none transition-[border-color,background-color] duration-150 placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--line-strong)] focus-visible:border-[color:var(--line-strong)]";

const FluidInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(controlClassName, "fluid-input", className)}
    {...props}
  />
));

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
