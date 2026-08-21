import type { Metadata } from "next";
import { Instrument_Serif, Newsreader } from "next/font/google";
import "./globals.css";

/**
 * Instrument Serif carries verdicts and numerals; Newsreader carries prose.
 *
 * Self-hosted by next/font rather than linked from Google: a <link> to
 * fonts.googleapis.com is a render-blocking request to a third party, and a
 * page whose entire job is a single legible verdict should not depend on
 * someone else's CDN to say it.
 */
const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const prose = Newsreader({
  subsets: ["latin"],
  variable: "--font-prose",
  display: "swap",
});

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
    <html lang="en" className={`${display.variable} ${prose.variable}`}>
      <body>{children}</body>
    </html>
  );
}
