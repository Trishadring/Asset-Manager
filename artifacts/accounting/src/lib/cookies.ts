const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function setCookie(name: string, value: string, maxAgeSeconds = YEAR_SECONDS) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax${secure}`;
}

export function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

export function deleteCookie(name: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax${secure}`;
}
