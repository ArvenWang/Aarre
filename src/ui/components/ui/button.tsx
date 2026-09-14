import { forwardRef, isValidElement, type ButtonHTMLAttributes, type ComponentProps, type ReactElement, type AnchorHTMLAttributes } from "react";
import { Button as HeroButton } from "@heroui/react/button";
import { Link as HeroLink } from "@heroui/react/link";
import { Spinner } from "@heroui/react/spinner";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "danger-quiet";
type Size = "sm" | "md" | "lg" | "icon-sm" | "icon" | "icon-lg" | "unstyled";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | null; size?: Size | null; asChild?: boolean; loading?: boolean;
  leadingIcon?: IconComponent; trailingIcon?: IconComponent; active?: boolean;
}
const variants = { primary: "primary", secondary: "secondary", tertiary: "outline", ghost: "ghost", danger: "danger", "danger-quiet": "danger-soft" } as const;
export const buttonVariants = ({ variant = "primary", size = "md" }: { variant?: Variant | null; size?: Size | null } = {}) => `aarre-button aarre-button--${variant} aarre-button--${size}`;
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "primary", size = "md", asChild, loading, leadingIcon: Leading, trailingIcon: Trailing,
  active, disabled, children, className, onClick, ...props
}, ref) {
  const classes = cn(buttonVariants({ variant, size }), className);
  const iconOnly = Boolean(size?.startsWith("icon"));
  const child = asChild && isValidElement(children) ? children as ReactElement<AnchorHTMLAttributes<HTMLAnchorElement>> : null;
  const content = <span data-slot="button-content" className="aarre-button-content">
    {loading ? <Spinner size="sm" /> : Leading ? <Leading size={16} aria-hidden="true" /> : null}
    {child ? child.props.children : children}
    {Trailing && <Trailing size={16} aria-hidden="true" />}
  </span>;
  if (child) return <HeroLink {...(child.props as ComponentProps<typeof HeroLink>)} isDisabled={disabled || loading} className={classes} data-slot="button" data-variant={variant}>{content}</HeroLink>;
  return <HeroButton {...(props as ComponentProps<typeof HeroButton>)} ref={ref} type={props.type || "button"}
    variant={variants[variant || "primary"]} size={size === "lg" || size === "icon-lg" ? "lg" : size === "sm" || size === "icon-sm" ? "sm" : "md"}
    isIconOnly={iconOnly} isDisabled={disabled || loading} isPending={loading}
    onClick={onClick as ComponentProps<typeof HeroButton>["onClick"]}
    data-slot="button" data-variant={variant} data-held={active || undefined}
    className={classes}>{content}</HeroButton>;
});
export type { ButtonProps };
