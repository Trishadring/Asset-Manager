import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getCookie, setCookie } from "@/lib/cookies";

interface CredentialsContextValue {
  email: string;
  token: string;
  setEmail: (v: string) => void;
  setToken: (v: string) => void;
  save: () => void;
  saved: boolean;
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null);

export function CredentialsProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmailState] = useState("");
  const [token, setTokenState] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const e = getCookie("manapool_email");
    const t = getCookie("manapool_token");
    if (e) setEmailState(e);
    if (t) setTokenState(t);
  }, []);

  const setEmail = useCallback((v: string) => {
    setEmailState(v);
    setSaved(false);
  }, []);

  const setToken = useCallback((v: string) => {
    setTokenState(v);
    setSaved(false);
  }, []);

  const save = useCallback(() => {
    setCookie("manapool_email", email);
    setCookie("manapool_token", token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [email, token]);

  return (
    <CredentialsContext.Provider value={{ email, token, setEmail, setToken, save, saved }}>
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials() {
  const ctx = useContext(CredentialsContext);
  if (!ctx) throw new Error("useCredentials must be used inside CredentialsProvider");
  return ctx;
}
