import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Rebel Woods Weekly Care",
  description: "Weekly horse care updates and conversations for the Rebel Woods family.",
};

export const viewport: Viewport = {
  themeColor: "#1d3528",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
