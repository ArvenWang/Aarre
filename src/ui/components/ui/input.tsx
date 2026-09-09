import {
  forwardRef,
  useRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Input as HeroInput } from "@heroui/react/input";
import { TextArea as HeroTextarea } from "@heroui/react/textarea";
import { cn } from "@/lib/utils";
import { FloatingScrollbars } from "./scroll-area";

// Form fields focus by darkening their own border. An accent ring around the
// field reads as a green selection frame and is not used here — that token
// stays for keyboard focus on buttons and other non-field controls.
const controlClassName =
  "fluid-control w-full border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] outline-none transition-[border-color,background-color] duration-150 placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--line-strong)] focus-visible:border-[color:var(--line-strong)]";

const FluidInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <HeroInput
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
>(({ className, ...props }, ref) => {
  const viewportRef = useRef<HTMLTextAreaElement>(null);
  return <div className="fluid-textarea-frame">
  <HeroTextarea
    ref={node => { viewportRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
    className={cn(controlClassName, "fluid-textarea", className)}
    {...props}
  />
  <FloatingScrollbars viewportRef={viewportRef} label={props["aria-label"] || "文本"} />
  </div>;
});

FluidTextarea.displayName = "FluidTextarea";

export { FluidInput, FluidTextarea };
