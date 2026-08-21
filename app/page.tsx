import Link from "next/link";
import Wizard from "@/components/Wizard";

export default function Home() {
  return (
    <>
      <Wizard />
      <Link
        href="/case-study"
        style={{
          position: "fixed",
          top: 16,
          right: 18,
          zIndex: 50,
          padding: "9px 14px",
          border: "1px solid rgba(27,27,27,.16)",
          borderRadius: 999,
          background: "rgba(255,255,255,.86)",
          backdropFilter: "blur(10px)",
          color: "#1B1B1B",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
          letterSpacing: ".08em",
          textTransform: "uppercase",
        }}
      >
        Case study
      </Link>
    </>
  );
}
