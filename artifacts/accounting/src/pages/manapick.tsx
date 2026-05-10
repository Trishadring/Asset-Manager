import { useCredentials } from "@/lib/credentials-context";

export default function ManaPick() {
  const { email, token } = useCredentials();

  const params = new URLSearchParams();
  if (email) params.set("mp_email", email);
  if (token) params.set("mp_token", token);
  const query = params.toString();
  const src = query ? `/?${query}` : "/";

  return (
    <iframe
      src={src}
      className="flex-1 w-full border-0 min-h-0"
      style={{ height: "100vh" }}
      title="ManaPick"
    />
  );
}
