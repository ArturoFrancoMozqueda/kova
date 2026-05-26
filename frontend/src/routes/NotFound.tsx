import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { copy } from "@/i18n/messages";

export default function NotFound() {
  useDocumentTitle(copy.documentTitles.notFound);
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-6 bg-[color:var(--kova-mist)]">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-6">
          <div className="flex justify-center">
            <LogoMark className="h-12 w-12" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-[color:var(--kova-ink)]">
              {copy.notFound.heading}
            </h1>
            <p className="text-sm text-[color:var(--kova-muted)]">
              {copy.notFound.body}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link to="/dashboard" className={cn(buttonVariants({ size: "lg" }))}>
              {copy.notFound.backToDashboard}
            </Link>
            <Link
              to="/register"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              {copy.notFound.goToRegister}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
