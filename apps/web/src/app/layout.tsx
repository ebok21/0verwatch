import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "0VERWATCH — Prediction Market Intelligence & Guard Watch",
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

