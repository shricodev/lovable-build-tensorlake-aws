import { Code2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-background p-6 text-foreground">
      <Card className="max-w-md text-center">
        <CardHeader>
          <Code2 className="mx-auto size-8 text-primary" />
          <CardTitle>Ready for your app</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Your first prompt will replace this starter.
        </CardContent>
      </Card>
    </main>
  );
}
