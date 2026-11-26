import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Défi Photo",
  description: "Le jeu de défis photo en équipes, directement sur téléphone.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
