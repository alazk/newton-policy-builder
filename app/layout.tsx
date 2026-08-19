import type { Metadata } from "next";
import "./globals.css";

/**
 * The description is stale: this stopped being a policy composer when the rule
 * toggles came out. It screens both sides of a transfer against sanctions
 * lists and returns a quorum-signed decision.
 */
export const metadata: Metadata = {
  title: "Newton AML/OFAC Policy Engine",
  description:
    "Sanctions screening enforced before a transaction executes. Sender and recipient are checked against OFAC, EU, UN and UK lists, and the decision is signed by an operator quorum on Ethereum Sepolia.",
  openGraph: {
    title: "Newton AML/OFAC Policy Engine",
    description:
      "Sanctions screening enforced before a transaction executes, signed by an operator quorum on Ethereum Sepolia.",
    type: "website",
  },
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
