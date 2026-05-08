import React from "react";
import { cn } from "../../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "danger" | "offline";
}

export function Badge({ className, variant = "default", children, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors border",
        {
          "bg-white/10 text-white border-white/20": variant === "default",
          "bg-white/10 text-white border-white/30 shadow-[0_0_10px_rgba(255,255,255,0.2)]": variant === "success",
          "bg-neutral-800 text-neutral-300 border-neutral-600": variant === "warning",
          "bg-black/50 text-neutral-400 border-white/10": variant === "danger",
          "bg-black text-neutral-500 border-white/5": variant === "offline",
        },
        className
      )}
      {...props}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", {
        "bg-white animate-pulse": variant === "success",
        "bg-neutral-400": variant === "default",
        "bg-neutral-500": variant === "warning",
        "bg-neutral-600": variant === "danger",
        "bg-neutral-700": variant === "offline",
      })} />
      {children}
    </div>
  );
}
