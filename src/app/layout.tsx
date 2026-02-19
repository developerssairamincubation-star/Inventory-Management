import "./globals.css";
import NextTopLoader from "nextjs-toploader";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <NextTopLoader color="#475569" showSpinner={false} />
        {children}
      </body>
    </html>
  );
}
