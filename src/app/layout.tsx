import "./globals.css";
import NextTopLoader from "nextjs-toploader";
import { ToastProvider } from "@/components/ui/Toast";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <NextTopLoader color="#475569" showSpinner={false} />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
