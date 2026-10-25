import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Драфт-помощник",
  description: "Подбор мид-героя под драфт с учётом личного пула",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
