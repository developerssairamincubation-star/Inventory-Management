import "./globals.css";
import NextTopLoader from "nextjs-toploader";
import { ToastProvider } from "@/components/ui/Toast";
import { UserProvider } from "@/contexts/UserContext";
import QueryProvider from "@/components/QueryProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <NextTopLoader color="#475569" showSpinner={false} />
        <QueryProvider>
          <UserProvider>
            <ToastProvider>{children}</ToastProvider>
          </UserProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
