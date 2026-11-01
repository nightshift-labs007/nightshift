"use client";
import { useEffect, useState } from "react";

const KEY = "fp.token";

export function useSession() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    try {
      setToken(localStorage.getItem(KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);
  return {
    token,
    userId: token ? (JSON.parse(atob(token.split(".")[1]!)) as { sub: string }).sub : null,
    signIn(t: string) {
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* storage unavailable */
      }
      setToken(t);
    },
    signOut() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* storage unavailable */
      }
      setToken(null);
    },
  };
}
