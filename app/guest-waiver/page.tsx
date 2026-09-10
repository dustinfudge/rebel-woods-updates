import type { Metadata } from "next";

import { GuestWaiverForm } from "@/components/GuestWaiverForm";

export const metadata: Metadata = {
  title: "Guest Liability Waiver | Rebel Woods",
  description: "Read, complete, and electronically sign the Rebel Woods guest liability waiver.",
  robots: { index: false, follow: false },
};

export default function GuestWaiverPage(): React.JSX.Element {
  return <GuestWaiverForm />;
}
