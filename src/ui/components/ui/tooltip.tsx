import { cloneElement, createContext, useContext, type ReactElement, type ReactNode } from "react";
import { Tooltip as HeroTooltip } from "@heroui/react/tooltip";
import { mergeProps } from "react-aria/mergeProps";
import { cn } from "@/lib/utils";
type TooltipSide = "top" | "right" | "bottom" | "left";
interface TooltipProps { content: ReactNode; children: ReactElement; side?: TooltipSide; sideOffset?: number; delayDuration?: number; className?: string; forceOpen?: boolean; onOpenChange?: (open: boolean) => void }
interface TooltipProviderProps { children: ReactNode; delayDuration?: number; skipDelayDuration?: number }
const Delay = createContext(300);
const Portal = createContext<HTMLElement | null>(null);
export const TooltipPortalContainer = Portal.Provider;
export function TooltipProvider({ children, delayDuration = 300 }: TooltipProviderProps) { return <Delay.Provider value={delayDuration}>{children}</Delay.Provider>; }
export function Tooltip({ content, children, side = "top", sideOffset = 8, delayDuration, className, forceOpen, onOpenChange }: TooltipProps) {
  const delay = useContext(Delay);
  const container = useContext(Portal);
  return <HeroTooltip delay={delayDuration ?? delay} isOpen={forceOpen} onOpenChange={onOpenChange}>
    <HeroTooltip.Trigger render={(props) => cloneElement(children, mergeProps(children.props as Record<string, unknown>, props))} />
    <HeroTooltip.Content placement={side} offset={sideOffset} UNSTABLE_portalContainer={container || undefined} className={cn("aarre-tooltip", className)}>{content}</HeroTooltip.Content>
  </HeroTooltip>;
}
export type { TooltipProps, TooltipProviderProps, TooltipSide };
