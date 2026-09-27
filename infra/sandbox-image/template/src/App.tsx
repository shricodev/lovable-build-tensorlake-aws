import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-background p-6 text-foreground">
      <Card className="max-w-md text-center">
        <CardHeader>
          <Sparkles className="mx-auto size-8 text-primary" />
          <CardTitle>Your app is warming up</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Describe what you want to build and Kiln will write it here.
        </CardContent>
      </Card>
    </main>
  );
}
