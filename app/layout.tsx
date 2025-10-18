import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podio Migration Agent",
  description: "AI-powered Podio workflow migration tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
