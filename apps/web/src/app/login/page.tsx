import { redirect } from "next/navigation";
import { authProviders, signIn } from "@/auth";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { currentUser } from "@/server/session";

export default async function LoginPage() {
  if (await currentUser()) redirect("/projects");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Describe an app, watch it get built, keep iterating.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {authProviders.github && (
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo: "/projects" });
                }}
              >
                <Button type="submit" className="w-full">
                  Continue with GitHub
                </Button>
              </form>
            )}
            {authProviders.github && authProviders.dev && <Separator />}
            {authProviders.dev && (
              <form
                className="space-y-3"
                action={async (fd: FormData) => {
                  "use server";
                  await signIn("dev", {
                    username: String(fd.get("username") ?? ""),
                    redirectTo: "/projects",
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="username">Dev login</Label>
                  <Input
                    id="username"
                    name="username"
                    placeholder="your-name"
                    required
                    pattern="[a-zA-Z0-9-]{2,32}"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Local development only. Disabled in production.
                  </p>
                </div>
                <Button
                  type="submit"
                  variant={authProviders.github ? "outline" : "default"}
                  className="w-full"
                >
                  Sign in
                </Button>
              </form>
            )}
            {!authProviders.github && !authProviders.dev && (
              <p className="text-sm text-muted-foreground">
                No sign-in method is configured. Set AUTH_GITHUB_ID / AUTH_GITHUB_SECRET, or DEV_LOGIN=true
                for local development.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
