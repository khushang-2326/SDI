import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Auto Submitter",
  description: "Custom lead submission dashboard for approved demo websites"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
