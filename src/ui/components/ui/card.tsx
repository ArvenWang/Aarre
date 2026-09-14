import { Card as HeroCard } from "@heroui/react/card";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card({ className, children, ...props }, ref) {
  return <HeroCard {...props} ref={ref} className={cn("aarre-card", className)}>{children}</HeroCard>;
});
export const CardHeader = HeroCard.Header;
export const CardTitle = HeroCard.Title;
export const CardDescription = HeroCard.Description;
export const CardContent = HeroCard.Content;
export const CardFooter = HeroCard.Footer;
