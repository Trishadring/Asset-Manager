import { useState } from "react";
import { useCredentials } from "@/lib/credentials-context";
import { ExternalLink, AlertCircle } from "lucide-react";

export default function ManaPick() {
  const { email, token } = useCredentials();
  const [iframeError, setIframeError] = useState(false);

  const params = new URLSearchParams();
  if (email) params.set("mp_email", email);
  if (token) params.set("mp_token", token);
  const query = params.toString();
  const src = query ? `/?${query}` : "/";

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ height: "100vh" }}>
      {iframeError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertCircle className="h-10 w-10 opacity-40" />
          <p className="text-sm font-medium">ManaPick isn't reachable inside the frame.</p>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4"
          >
            <ExternalLink className="h-4 w-4" /> Open ManaPick in a new tab
          </a>
        </div>
      ) : (
        <iframe
          key={src}
          src={src}
          className="flex-1 w-full border-0"
          style={{ height: "100%" }}
          title="ManaPick"
          onError={() => setIframeError(true)}
        />
      )}
    </div>
  );
}
