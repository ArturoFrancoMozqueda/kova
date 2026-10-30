import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse-soft motion-reduce:animate-none rounded-kova-md bg-kova-mist", className)}
      {...props}
    />
  );
}

export { Skeleton };
