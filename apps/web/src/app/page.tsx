import { redirect } from "next/navigation";

// No public front page: visitors go straight to login, and signed-in users are sent on from there.
export default function Home() {
  redirect("/logg-inn");
}
