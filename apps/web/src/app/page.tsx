import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";

export default async function Home() {
  redirect((await currentUser()) ? "/projects" : "/login");
}
