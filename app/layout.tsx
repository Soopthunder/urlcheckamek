import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteCheck — Monitor de sitios",
  description: "Monitoreo de status y reportes de mejora para tus sitios web",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
