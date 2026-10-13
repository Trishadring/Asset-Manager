export function isPublicManaPickRoute(method: string, requestPath: string): boolean {
  const path = requestPath.replace(/^\/api(?=\/)/, "");
  const verb = method.toUpperCase();

  if (verb === "GET" && (path === "/manapick/orders" || path === "/manapick/sets")) {
    return true;
  }

  if (verb === "POST" && path === "/manapick/enrich") {
    return true;
  }

  return verb === "POST" && /^\/manapick\/orders\/[^/]+\/ship$/.test(path);
}

export function requiresManaPoolKey(method: string, requestPath: string): boolean {
  const path = requestPath.replace(/^\/api(?=\/)/, "");
  const verb = method.toUpperCase();

  return (
    (verb === "GET" && path === "/manapick/orders") ||
    (verb === "POST" && /^\/manapick\/orders\/[^/]+\/ship$/.test(path))
  );
}
