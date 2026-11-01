import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const KEY = "fp.token";

export function useSession() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then(setToken)
      .finally(() => setReady(true));
  }, []);
  const signIn = useCallback(async (t: string) => {
    await SecureStore.setItemAsync(KEY, t);
    setToken(t);
  }, []);
  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setToken(null);
  }, []);
  return { token, ready, signIn, signOut };
}
