import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OVERWATCH — Prediction Market Intelligence & Guard Watch",
  description:
    "AI-powered multi-agent research and continuous monitoring instrument for prediction markets on 0G Compute.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[#F6F5F0] text-[#111110] selection:bg-[#D9381E] selection:text-white`}
      >
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              borderRadius: "0px",
              border: "1px solid #111110",
              background: "#F6F5F0",
              color: "#111110",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}

