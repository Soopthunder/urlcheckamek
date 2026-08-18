import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "./register-sw";

export const metadata: Metadata = {
  title: "SiteCheck - Monitor de sitios",
  description: "Monitoreo de status y reportes de mejora para tus sitios web",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SiteCheck" },
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
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
