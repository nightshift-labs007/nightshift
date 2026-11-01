import { Providers } from "../../../providers";

// TanStack Query (live quotes, votes) is only loaded on basket pages, not on the feed.
export default function BasketLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
