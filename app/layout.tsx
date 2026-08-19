import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newton AML/OFAC Policy Engine",
  description:
    "Compose a compliance policy and evaluate it against a live oracle on Ethereum Sepolia.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased text-neutral-900">{children}</body>
    </html>
  );
}
