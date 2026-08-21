import Link from "next/link";

const INK = "#1B1B1B";
const FIELD = "#F1F1F1";
const SURFACE = "#FFFFFF";
const HAIRLINE = "#E2E2E2";
const MUTED = "#6B6B6B";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED }}>{children}</div>;
}

function AppCapture({ label }: { label: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: 20, overflow: "hidden", background: "#fff", boxShadow: "0 18px 60px rgba(0,0,0,.07)" }}>
        <div style={{ height: 34, borderBottom: `1px solid ${HAIRLINE}`, display: "flex", alignItems: "center", gap: 7, padding: "0 14px", background: "#FAFAFA" }}>
          {[1,2,3].map((n) => <span key={n} style={{ width: 8, height: 8, borderRadius: 999, background: "#D7D7D7" }} />)}
          <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 10, color: MUTED }}>newton-policy-builder.vercel.app</span>
        </div>
        <iframe src="/" title={label} style={{ width: "100%", height: 620, border: 0, display: "block" }} />
      </div>
      <figcaption style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: MUTED }}>{label}</figcaption>
    </figure>
  );
}

export default function CaseStudy() {
  return (
    <main style={{ background: FIELD, minHeight: "100vh", color: INK }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 22px 100px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 90 }}>
          <Link href="/" style={{ fontFamily: MONO, fontSize: 12 }}>← Policy builder</Link>
          <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>CASE STUDY / AML / OFAC</span>
        </header>

        <section style={{ maxWidth: 850, marginBottom: 100 }}>
          <SectionLabel>Hypothetical implementation</SectionLabel>
          <h1 style={{ fontFamily: "var(--display), Georgia, serif", fontSize: "clamp(56px, 9vw, 112px)", lineHeight: .9, letterSpacing: "-.035em", fontWeight: 400, margin: "18px 0 28px" }}>Putting basic AML controls into a rewards contract.</h1>
          <p style={{ fontFamily: "var(--prose), Georgia, serif", fontSize: 22, lineHeight: 1.45, maxWidth: 680, margin: 0 }}>A DeFi application can use an external sanctions or AML signal as an input to a Newton policy, then make that policy part of transaction authorization.</p>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 100 }}>
          {[
            ["01", "Risk signal", "A wallet is checked against a sanctions or AML source."],
            ["02", "Policy", "The application defines what the signal means: allow or block."],
            ["03", "Authorization", "Newton evaluates the policy before the controlled action executes."],
          ].map(([n, title, body]) => (
            <article key={n} style={{ background: SURFACE, border: `1px solid ${HAIRLINE}`, borderRadius: 18, padding: 24, minHeight: 190 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{n}</div>
              <h2 style={{ fontSize: 20, margin: "38px 0 10px", fontWeight: 600 }}>{title}</h2>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: MUTED, margin: 0 }}>{body}</p>
            </article>
          ))}
        </section>

        <section style={{ maxWidth: 820, marginBottom: 100 }}>
          <SectionLabel>The scenario</SectionLabel>
          <h2 style={{ fontFamily: "var(--display), Georgia, serif", fontSize: 54, lineHeight: 1, fontWeight: 400, margin: "16px 0 22px" }}>A rewards contract with one additional condition.</h2>
          <p style={{ fontSize: 18, lineHeight: 1.65, color: "#444", margin: 0 }}>A protocol distributes tokens to eligible users. It is not an exchange and does not maintain a full compliance stack. The team wants a basic control: do not authorize reward claims from wallets that appear on a configured sanctions list or are identified by its AML source as prohibited.</p>
        </section>

        <section style={{ marginBottom: 100 }}>
          <SectionLabel>The policy</SectionLabel>
          <div style={{ marginTop: 18, background: "#202020", color: "#F4F4F4", borderRadius: 20, padding: "28px 32px", fontFamily: MONO, fontSize: 14, lineHeight: 1.9, overflowX: "auto" }}>
            <div><span style={{ color: "#9E9E9E" }}>IF</span> recipient is OFAC-sanctioned</div>
            <div style={{ paddingLeft: 24 }}>→ <strong>BLOCK</strong></div>
            <div style={{ marginTop: 10 }}><span style={{ color: "#9E9E9E" }}>IF</span> recipient is flagged by the configured AML source</div>
            <div style={{ paddingLeft: 24 }}>→ <strong>BLOCK</strong></div>
            <div style={{ marginTop: 10 }}><span style={{ color: "#9E9E9E" }}>OTHERWISE</span></div>
            <div style={{ paddingLeft: 24 }}>→ <strong>ALLOW</strong></div>
          </div>
          <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.55, marginTop: 14, maxWidth: 700 }}>The screening provider supplies the signal. The application defines the policy. Newton evaluates the policy and provides the authorization decision.</p>
        </section>

        <section style={{ marginBottom: 100 }}>
          <SectionLabel>Live application captures</SectionLabel>
          <h2 style={{ fontFamily: "var(--display), Georgia, serif", fontSize: 54, lineHeight: 1, fontWeight: 400, margin: "16px 0 18px" }}>See the policy evaluate a transfer.</h2>
          <p style={{ color: MUTED, fontSize: 16, lineHeight: 1.55, maxWidth: 700, marginBottom: 28 }}>The captures below use the deployed Newton policy builder itself, so the interface remains interactive. Use the controls inside the frame to test a clean address and a real designated address.</p>
          <div style={{ display: "grid", gap: 28 }}>
            <AppCapture label="01 / Policy applied and ready to screen" />
            <AppCapture label="02 / Same policy, different transaction inputs" />
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 100 }}>
          <article style={{ background: SURFACE, border: `1px solid ${HAIRLINE}`, borderRadius: 20, padding: 28 }}>
            <SectionLabel>Clean wallet</SectionLabel>
            <div style={{ fontFamily: "var(--display), Georgia, serif", fontSize: 48, margin: "24px 0 10px" }}>ALLOW</div>
            <p style={{ color: MUTED, lineHeight: 1.55, margin: 0 }}>No configured sanctions match. The policy permits the controlled action.</p>
          </article>
          <article style={{ background: "#EBC49F", border: "1px solid #D7A976", borderRadius: 20, padding: 28 }}>
            <SectionLabel>Designated wallet</SectionLabel>
            <div style={{ fontFamily: "var(--display), Georgia, serif", fontSize: 48, margin: "24px 0 10px" }}>BLOCK</div>
            <p style={{ color: "#5A4635", lineHeight: 1.55, margin: 0 }}>The policy detects a sanctions match and the transaction is denied rather than executed.</p>
          </article>
        </section>

        <section style={{ maxWidth: 820, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 42 }}>
          <SectionLabel>The point</SectionLabel>
          <h2 style={{ fontFamily: "var(--display), Georgia, serif", fontSize: 52, lineHeight: 1, fontWeight: 400, margin: "16px 0 20px" }}>Detection is the input. Authorization is the control.</h2>
          <p style={{ fontSize: 18, lineHeight: 1.65, color: "#444", margin: 0 }}>Newton does not need to replace the system that identifies risk. It provides the layer where an application turns that signal into a policy decision and ties the decision to authorization. The same pattern can be applied to rewards, token claims, grants, treasury transfers, and other smart-contract actions.</p>
        </section>

        <footer style={{ marginTop: 100, paddingTop: 30, borderTop: `1px solid ${HAIRLINE}`, display: "grid", gap: 10 }}>
          <SectionLabel>Sources</SectionLabel>
          <a href="https://www.trmlabs.com/resources/blog/how-shelbit-became-a-usd-6-3-billion-settlement-layer-for-irans-illicit-economy" target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 11 }}>TRM Labs / Shelbit blockchain analysis ↗</a>
          <a href="https://public-inspection.federalregister.gov/2026-16573.pdf" target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 11 }}>U.S. Federal Register / Shelbit designation ↗</a>
          <a href="https://docs.newton.xyz/" target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 11 }}>Newton documentation ↗</a>
        </footer>
      </div>
    </main>
  );
}
