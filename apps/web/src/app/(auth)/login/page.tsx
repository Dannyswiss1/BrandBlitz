import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginButton } from "@/components/auth/login-button";

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome to BrandBlitz</CardTitle>
        <CardDescription>Sign in to compete and earn USDC rewards</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Suspense fallback={<Skeleton className="h-11 w-full" />}>
          <LoginButton />
        </Suspense>
        <p className="text-xs text-center text-[var(--muted-foreground)]">
          By signing in you agree to our Terms of Service and Privacy Policy.
        </p>
      </CardContent>
    </Card>
  );
}
