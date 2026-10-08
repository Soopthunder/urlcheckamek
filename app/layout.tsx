import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteCheck - Monitor de sitios",
  description: "Monitoreo de status y reportes de mejora para tus sitios web",
};

export const viewport: Viewport = {
  // ponytail: a custom `viewport` export REPLACES Next's default entirely —
  // omitting width/initialScale here (as before) drops device-width scaling,
  // which is exactly what made the installed iOS PWA render desktop-wide.
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
      </body>
    </html>
  );
}
