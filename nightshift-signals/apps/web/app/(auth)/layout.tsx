import { Providers } from "../providers";

// TanStack Query is only loaded where it is used, keeping it out of the feed's first load.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
