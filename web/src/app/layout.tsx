import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { loadData } from "@/lib/data";

// один шрифт на всё приложение, грузится при сборке (next/font), в рантайме сеть не нужна
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Outpick",
  description: "Пикер для Dota 2 под твой пул: контрпики, синергии, разбор матчей",
};

export const dynamic = "force-dynamic"; // герои и алиасы читаются при каждом запросе: мета обновляется без пересборки

export default function RootLayout({ children }: LayoutProps<"/">) {
  // пикер живёт в оболочке на всех страницах (скрыт вне «/»): его цикл опроса Доты, чтение экрана, автозапись драфта
  // и данные для оверлея должны работать, даже когда открыта История или Настройки
  const { heroes, aliases } = loadData(null);
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <html lang="ru" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col"><AppShell heroes={sorted} aliases={aliases}>{children}</AppShell></body>
    </html>
  );
}
