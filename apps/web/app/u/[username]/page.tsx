import { PublicPage } from "../../ui";

export default async function Page({
  params
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <PublicPage key={username} username={username} />;
}
