export function isPublicManaPickRoute(method: string, requestPath: string): boolean {
  const path = requestPath.replace(/^\/api(?=\/)/, "");
  const verb = method.toUpperCase();

  if (
    (verb === "GET" &&
      [
        "/manapick/oauth/start",
        "/manapick/oauth/callback",
        "/manapick/oauth/status",
      ].includes(path)) ||
    (verb === "POST" && path === "/manapick/oauth/disconnect")
  ) {
    return true;
  }

  if (verb === "GET" && (path === "/manapick/orders" || path === "/manapick/sets")) {
    return true;
  }

  if (verb === "POST" && path === "/manapick/enrich") {
    return true;
  }

  return verb === "POST" && /^\/manapick\/orders\/[^/]+\/ship$/.test(path);
}
