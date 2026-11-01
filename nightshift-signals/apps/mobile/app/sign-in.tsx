import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/format";
import { useSession } from "../lib/session";

// Local mode only (/v1/auth/local). Live sign-in goes through the embedded-wallet provider, which issues the same JWT.
export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      const { token } = await api<{ token: string }>("/auth/local", { method: "POST", body: JSON.stringify({ email }) });
      await signIn(token);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Email</Text>
      <TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.muted} />
      <Pressable style={s.btn} onPress={submit}>
        <Text style={s.btnText}>Sign in</Text>
      </Pressable>
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10 },
  label: { color: colors.muted, fontSize: 12 },
  input: { color: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  btn: { backgroundColor: colors.hot, borderRadius: 8, padding: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "700" },
  error: { color: colors.miss },
});
