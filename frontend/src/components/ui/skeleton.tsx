import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse-soft rounded-kova-md bg-kova-mist", className)}
      {...props}
    />
  );
}

export { Skeleton };
