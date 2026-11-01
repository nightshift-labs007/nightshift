import "../lib/background"; // defines the background task before anything else runs
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "../lib/format";

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.ink },
          headerTintColor: colors.paper,
          contentStyle: { backgroundColor: colors.ink },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Nightshift Signals" }} />
        <Stack.Screen name="b/[id]" options={{ title: "Basket" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", presentation: "modal" }} />
      </Stack>
    </>
  );
}
